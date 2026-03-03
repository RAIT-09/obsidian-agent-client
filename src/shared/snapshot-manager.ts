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
	/** A tool call with `kind: "delete"` targeted this path */
	wasDeletedByAgent: boolean;
	rawPath: string;
	/** True when original was captured from diff `oldText`, false for disk fallback */
	fromDiff: boolean;
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
	/** vault-relative path -> accepted baseline state for this session */
	private originals = new Map<string, OriginalFileState>();

	/** vault-relative path -> content right before we reverted (null = file didn't exist) */
	private preRevertBackups = new Map<string, string | null>();

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
			const existing = this.originals.get(file.vaultPath);
			if (existing) {
				if (file.wasDeleted && !existing.wasDeletedByAgent) {
					existing.wasDeletedByAgent = true;
				}
				if (!existing.fromDiff && file.firstOldText !== undefined) {
					existing.content =
						typeof file.firstOldText === "string"
							? file.firstOldText
							: null;
					existing.isNew = file.firstOldText === null;
					existing.fromDiff = true;
				}
				continue;
			}

			if (typeof file.firstOldText === "string") {
				this.originals.set(file.vaultPath, {
					content: file.firstOldText,
					isNew: false,
					wasDeletedByAgent: file.wasDeleted,
					rawPath: file.rawPath,
					fromDiff: true,
				});
				continue;
			}

			if (file.firstOldText === null) {
				this.originals.set(file.vaultPath, {
					content: null,
					isNew: true,
					wasDeletedByAgent: file.wasDeleted,
					rawPath: file.rawPath,
					fromDiff: true,
				});
				continue;
			}

			const content = await this.tryReadFile(
				{ readFile } as FileIo,
				file.vaultPath,
			);
			this.originals.set(file.vaultPath, {
				content,
				isNew: file.wasDeleted ? false : content == null,
				wasDeletedByAgent: file.wasDeleted,
				rawPath: file.rawPath,
				fromDiff: false,
			});
		}
	}

	/**
	 * Build the visible change set by comparing every captured snapshot with
	 * the current file content on disk. Files whose content hasn't changed are
	 * filtered out.
	 */
	async computeChanges(
		messages: ChatMessage[],
		vaultBasePath: string | undefined,
		readFile: (path: string) => Promise<string>,
	): Promise<SessionChangeSet | null> {
		await this.captureSnapshots(messages, vaultBasePath, readFile);

		const changes: FileChange[] = [];

		for (const [vaultPath, original] of this.originals) {
			const current = await this.tryReadFile(
				{ readFile } as FileIo,
				vaultPath,
			);

			const isDeleted = !original.isNew && current == null;

			if (original.isNew && current == null) continue;

			if (
				original.content != null &&
				current != null &&
				trimEnd(original.content) === trimEnd(current)
			) {
				continue;
			}

			if (original.content === current && !isDeleted) continue;

			changes.push({
				path: original.rawPath,
				vaultPath,
				isNewFile: original.isNew,
				isDeleted,
				canRevert: isDeleted ? original.content != null : true,
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
			this.preRevertBackups.set(vaultPath, current);

			const writePath = vaultPath.normalize("NFC");
			if (original.isNew) {
				await io.deleteFile(writePath);
			} else if (original.content != null) {
				await io.writeFile(writePath, original.content);
			} else {
				return { reverted: false, conflict: true };
			}

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
		this.advanceBaseline(change);
	}

	dismissAll(changes: FileChange[]): void {
		for (const change of changes) {
			this.advanceBaseline(change);
		}
		this.preRevertBackups.clear();
	}

	async undoRevert(io: Pick<FileIo, "writeFile" | "deleteFile">): Promise<void> {
		for (const [path, content] of this.preRevertBackups) {
			if (content == null) {
				await io.deleteFile(path);
			} else {
				await io.writeFile(path, content);
			}
		}
		this.preRevertBackups.clear();
	}

	get canUndo(): boolean {
		return this.preRevertBackups.size > 0;
	}

	reset(): void {
		this.originals.clear();
		this.preRevertBackups.clear();
	}

	private advanceBaseline(change: FileChange): void {
		const vaultPath = change.vaultPath;
		if (!vaultPath) return;

		const existing = this.originals.get(vaultPath);
		const nextContent = change.isDeleted ? null : change.finalText;

		this.originals.set(vaultPath, {
			content: nextContent,
			isNew: change.isDeleted,
			wasDeletedByAgent:
				change.isDeleted || existing?.wasDeletedByAgent === true,
			rawPath: existing?.rawPath ?? change.path,
			// Treat accepted state as authoritative baseline for future comparisons.
			fromDiff: true,
		});
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
