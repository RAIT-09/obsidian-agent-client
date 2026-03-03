import { useState, useCallback, useRef } from "react";
import { type App, MarkdownView } from "obsidian";
import type { ChatMessage } from "../domain/models/chat-message";
import { getLastAssistantMessage } from "../shared/session-file-restoration";
import type { SessionChangeSet } from "../shared/session-file-restoration";
import { SnapshotManager, type FileIo } from "../shared/snapshot-manager";

export type { FileIo as RevertFileIo };

export interface RevertFileResult {
	reverted: boolean;
	conflict: boolean;
}

export interface UseSessionRestoreReturn {
	isRestored: boolean;
	changeSet: SessionChangeSet | null;

	reset: () => void;
	refreshChanges: (
		messages: ChatMessage[],
		vaultBasePath?: string,
		readFile?: (path: string) => Promise<string>,
	) => Promise<void>;
	dismiss: () => void;
	keepFile: (changePath: string) => void;

	revertFile: (
		changePath: string,
		io: FileIo,
	) => Promise<RevertFileResult>;
	revertChanges: (
		io: FileIo,
	) => Promise<{ reverted: string[]; conflicts: string[] }>;

	copyLastAssistantMessage: (messages: ChatMessage[]) => boolean;
	insertLastAssistantMessage: (app: App, messages: ChatMessage[]) => boolean;
}

export function useSessionRestore(): UseSessionRestoreReturn {
	const [isRestored, setIsRestored] = useState(false);
	const [changeSet, setChangeSet] = useState<SessionChangeSet | null>(null);
	const managerRef = useRef(new SnapshotManager());
	const refreshCallIdRef = useRef(0);

	const syncState = useCallback((cs: SessionChangeSet | null) => {
		setChangeSet(cs);
		setIsRestored(cs !== null);
	}, []);

	const refreshChanges = useCallback(
		async (
			messages: ChatMessage[],
			vaultBasePath?: string,
			readFile?: (path: string) => Promise<string>,
		) => {
			if (!readFile) return;
			const callId = ++refreshCallIdRef.current;
			const manager = managerRef.current;
			const result = await manager.computeChanges(
				messages,
				vaultBasePath,
				readFile,
			);
			if (callId !== refreshCallIdRef.current) return;
			syncState(result);
		},
		[syncState],
	);

	const dismiss = useCallback(() => {
		const manager = managerRef.current;
		if (changeSet) {
			manager.dismissAll(changeSet.changes);
		}
		syncState(null);
	}, [changeSet, syncState]);

	const reset = useCallback(() => {
		managerRef.current.reset();
		syncState(null);
	}, [syncState]);

	const keepFile = useCallback(
		(changePath: string) => {
			if (!changeSet) return;
			const change = changeSet.changes.find(
				(item) => item.path === changePath,
			);
			if (change) {
				managerRef.current.keepFile(change);
			}
			setChangeSet((prev) => {
				if (!prev) return null;
				const remaining = prev.changes.filter(
					(item) => item.path !== changePath,
				);
				if (remaining.length === 0) {
					setIsRestored(false);
					return null;
				}
				return { changes: remaining };
			});
		},
		[changeSet],
	);

	const revertFile = useCallback(
		async (
			changePath: string,
			io: FileIo,
		): Promise<RevertFileResult> => {
			if (!changeSet) return { reverted: false, conflict: false };
			const change = changeSet.changes.find(
				(item) => item.path === changePath,
			);
			if (!change) return { reverted: false, conflict: false };

			const result = await managerRef.current.revertFile(change, io);
			if (result.reverted) {
				setChangeSet((prev) => {
					if (!prev) return null;
					const remaining = prev.changes.filter(
						(item) => item.path !== changePath,
					);
					if (remaining.length === 0) {
						setIsRestored(false);
						return null;
					}
					return { changes: remaining };
				});
			}
			return result;
		},
		[changeSet],
	);

	const revertChanges = useCallback(
		async (
			io: FileIo,
		): Promise<{ reverted: string[]; conflicts: string[] }> => {
			if (!changeSet) return { reverted: [], conflicts: [] };

			const { reverted, conflicts } = await managerRef.current.revertAll(
				changeSet.changes,
				io,
			);

			if (reverted.length > 0) {
				const revertedSet = new Set(reverted);
				const remaining = changeSet.changes.filter(
					(c) => !revertedSet.has(c.path),
				);
				syncState(
					remaining.length > 0 ? { changes: remaining } : null,
				);
			}

			return { reverted, conflicts };
		},
		[changeSet, syncState],
	);

	const copyLastAssistantMessage = useCallback(
		(messages: ChatMessage[]): boolean => {
			const text = getLastAssistantMessage(messages);
			if (!text) return false;
			void navigator.clipboard.writeText(text);
			return true;
		},
		[],
	);

	const insertLastAssistantMessage = useCallback(
		(app: App, messages: ChatMessage[]): boolean => {
			const text = getLastAssistantMessage(messages);
			if (!text) return false;

			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.editor) return false;

			const cursor = view.editor.getCursor();
			view.editor.replaceRange(text, cursor);
			return true;
		},
		[],
	);

	return {
		isRestored,
		changeSet,
		reset,
		refreshChanges,
		dismiss,
		keepFile,
		revertFile,
		revertChanges,
		copyLastAssistantMessage,
		insertLastAssistantMessage,
	};
}
