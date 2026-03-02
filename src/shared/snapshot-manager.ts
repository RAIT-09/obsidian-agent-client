import type { ChatMessage } from "../domain/models/chat-message";
import {
	discoverModifiedFiles,
	type FileChange,
	type SessionChangeSet,
} from "./session-file-restoration";

export interface FileIo {
	readFile: (path: string) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	deleteFile: (path: string) => Promise<void>;
}

export interface RevertResult {
	reverted: boolean;
	conflict: boolean;
}

interface OriginalFileState {
	content: string | null;
	isNew: boolean;
	rawPath: string;
}

/**
 * Preserves original file state for every file mentioned in the conversation.
 *
 * On first sighting of a file (via diff, rawInput, or location), captures the
 * original content — either from the diff's `oldText` (most reliable) or from
 * disk (best-effort for custom MCP tools). Change detection is purely
 * disk-based: compare each snapshot with the current file on disk.
 *
 * All I/O is injected via {@link FileIo} — no React or Obsidian dependencies.
 */
export class SnapshotManager {
	/** vault-relative path -> state before the agent first touched the file */
	private originals = new Map<string, OriginalFileState>();

	/** vault-relative path -> kept/reverted flag */
	private handledPaths = new Map<
		string,
		{ action: "kept" | "reverted" }
	>();

	/** vault-relative path -> content right before we reverted (for undo) */
	private preRevertBackups = new Map<string, string>();

	/**
	 * Discover all files mentioned in the conversation and record their
	 * original state on first sighting.
	 *
	 * Original content comes from (in priority order):
	 * 1. The first diff's `oldText` for that path (most reliable)
	 * 2. Reading the file from disk (captures content before agent writes)
	 *
	 * A file whose first `oldText` is null is flagged as new (`isNew: true`).
	 */
	async captureSnapshots(
		messages: ChatMessage[],
		vaultBasePath: string | undefined,
		readFile: (path: string) => Promise<string>,
	): Promise<void> {
		const files = discoverModifiedFiles(messages, vaultBasePath);

		for (const file of files) {
			if (this.originals.has(file.vaultPath)) continue;

			if (typeof file.firstOldText === "string") {
				this.originals.set(file.vaultPath, {
					content: file.firstOldText,
					isNew: false,
					rawPath: file.rawPath,
				});
				continue;
			}

			if (file.firstOldText === null) {
				this.originals.set(file.vaultPath, {
					content: null,
					isNew: true,
					rawPath: file.rawPath,
				});
				continue;
			}

			const content = await this.tryReadFile(
				{ readFile } as FileIo,
				file.vaultPath,
			);
			this.originals.set(file.vaultPath, {
				content,
				isNew: content == null,
				rawPath: file.rawPath,
			});
		}
	}

	/**
	 * Build the visible change set by comparing every captured snapshot with
	 * the current file content on disk. Files already kept/reverted are
	 * excluded. Files whose content hasn't changed are filtered out.
	 */
	async computeChanges(
		messages: ChatMessage[],
		vaultBasePath: string | undefined,
		readFile: (path: string) => Promise<string>,
	): Promise<SessionChangeSet | null> {
		await this.captureSnapshots(messages, vaultBasePath, readFile);

		const changes: FileChange[] = [];

		for (const [vaultPath, original] of this.originals) {
			if (this.handledPaths.has(vaultPath)) continue;

			const current = await this.tryReadFile(
				{ readFile } as FileIo,
				vaultPath,
			);

			if (original.isNew && current == null) continue;

			if (
				original.content != null &&
				current != null &&
				trimEnd(original.content) === trimEnd(current)
			) {
				continue;
			}

			if (original.content === current) continue;

			changes.push({
				path: original.rawPath,
				vaultPath,
				isNewFile: original.isNew,
				canRevert: true,
				originalText: original.content,
				finalText: current ?? "",
			});
		}

		return changes.length > 0 ? { changes } : null;
	}

	/**
	 * Revert a file: restore original content or delete if the file was new.
	 * Backs up current content first so {@link undoRevert} can restore it.
	 */
	async revertFile(
		change: FileChange,
		io: FileIo,
	): Promise<RevertResult> {
		const vaultPath = change.vaultPath;
		if (!vaultPath) return { reverted: false, conflict: true };

		const original = this.originals.get(vaultPath);
		if (!original) return { reverted: false, conflict: true };

		try {
			const current = await this.tryReadFile(io, vaultPath);
			if (current != null) {
				this.preRevertBackups.set(vaultPath, current);
			}

			const writePath = vaultPath.normalize("NFC");
			if (original.isNew) {
				await io.deleteFile(writePath);
			} else if (original.content != null) {
				await io.writeFile(writePath, original.content);
			} else {
				return { reverted: false, conflict: true };
			}

			this.handledPaths.set(vaultPath, { action: "reverted" });
			return { reverted: true, conflict: false };
		} catch {
			return { reverted: false, conflict: true };
		}
	}

	async revertAll(
		changes: FileChange[],
		io: FileIo,
	): Promise<{ reverted: string[]; conflicts: string[] }> {
		const reverted: string[] = [];
		const conflicts: string[] = [];

		for (const change of changes) {
			const result = await this.revertFile(change, io);
			if (result.reverted) {
				reverted.push(change.path);
			} else if (result.conflict) {
				conflicts.push(change.path);
			}
		}

		return { reverted, conflicts };
	}

	keepFile(change: FileChange): void {
		if (change.vaultPath) {
			this.handledPaths.set(change.vaultPath, { action: "kept" });
		}
	}

	dismissAll(changes: FileChange[]): void {
		for (const change of changes) {
			if (change.vaultPath) {
				this.handledPaths.set(change.vaultPath, { action: "kept" });
			}
		}
		this.preRevertBackups.clear();
	}

	async undoRevert(
		writeFile: (path: string, content: string) => Promise<void>,
	): Promise<void> {
		for (const [path, content] of this.preRevertBackups) {
			await writeFile(path, content);
		}
		this.preRevertBackups.clear();
	}

	get canUndo(): boolean {
		return this.preRevertBackups.size > 0;
	}

	reset(): void {
		this.originals.clear();
		this.handledPaths.clear();
		this.preRevertBackups.clear();
	}

	private async tryReadFile(
		io: FileIo,
		path: string,
	): Promise<string | null> {
		try {
			return await io.readFile(path);
		} catch {
			/* try NFC */
		}
		try {
			return await io.readFile(path.normalize("NFC"));
		} catch {
			/* try NFD */
		}
		try {
			return await io.readFile(path.normalize("NFD"));
		} catch {
			/* exhausted */
		}
		return null;
	}
}

function trimEnd(s: string): string {
	return s.replace(/\s+$/, "");
}
