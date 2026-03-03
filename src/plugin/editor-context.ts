import {
	MarkdownView,
	TFile,
	TFolder,
	parseLinktext,
	type App,
	type Editor,
	type EditorPosition,
	type EditorSelection,
	type EventRef,
	type Menu,
	type TAbstractFile,
	type WorkspaceLeaf,
} from "obsidian";
import type { IChatViewContainer } from "../domain/ports/chat-view-container.port";
import {
	normalizeChatContextReference,
	type ChatContextReference,
} from "../shared/chat-context-token";
import { pluginNotice } from "../shared/plugin-notice";
import {
	getImageMimeTypeForExtension,
	isMentionableExtension,
} from "../shared/mentionable-files";

export interface EditorContextHost {
	app: App;
	viewRegistry: {
		toFocused: <T>(action: (view: IChatViewContainer) => T) => T | null;
	};
	activateView: () => Promise<void>;
	registerEvent: (eventRef: EventRef) => void;
}

function comparePosition(a: EditorPosition, b: EditorPosition): number {
	if (a.line !== b.line) {
		return a.line - b.line;
	}
	return a.ch - b.ch;
}

function normalizeEditorSelection(selection: EditorSelection): {
	from: EditorPosition;
	to: EditorPosition;
} {
	const anchor = selection.anchor;
	const head = selection.head ?? selection.anchor;
	if (comparePosition(anchor, head) <= 0) {
		return { from: anchor, to: head };
	}
	return { from: head, to: anchor };
}

function getFocusedView(host: EditorContextHost): IChatViewContainer | null {
	return host.viewRegistry.toFocused((view) => view);
}

async function ensureFocusedView(
	host: EditorContextHost,
): Promise<IChatViewContainer | null> {
	const existing = getFocusedView(host);
	if (existing) {
		return existing;
	}

	await host.activateView();
	return getFocusedView(host);
}

function isContextAttachableFile(file: TAbstractFile): file is TFile {
	return file instanceof TFile && isMentionableExtension(file.extension);
}

function isImageFile(file: TFile): boolean {
	return getImageMimeTypeForExtension(file.extension) !== undefined;
}

function addSelectionContextMenuItem(
	host: EditorContextHost,
	menu: Menu,
	file: TFile,
	editor: Editor,
): void {
	if (!editor.somethingSelected()) {
		return;
	}

	const selections = editor.listSelections();
	if (selections.length === 0) {
		return;
	}

	const selection = normalizeEditorSelection(selections[0]);
	menu.addItem((item) =>
		item
			.setTitle("Add selection to current chat")
			.setIcon("plus-circle")
			.onClick(() => {
				void addContextToCurrentChat(host, {
					type: "selection",
					notePath: file.path,
					noteName: file.basename,
					selection,
				});
			}),
	);
}

function addFileContextMenuItem(
	host: EditorContextHost,
	menu: Menu,
	file: TFile,
	title: string,
): void {
	menu.addItem((item) =>
		item
			.setTitle(title)
			.setIcon("file-plus")
			.onClick(() => {
				void addContextToCurrentChat(host, {
					type: "file",
					notePath: file.path,
					noteName: file.basename,
				});
			}),
	);
}

function addImageFileContextMenuItem(
	host: EditorContextHost,
	menu: Menu,
	file: TFile,
): void {
	if (!isImageFile(file)) {
		return;
	}

	menu.addItem((item) =>
		item
			.setTitle("Add image to current chat")
			.setIcon("image-plus")
			.onClick(() => {
				void addContextToCurrentChat(host, {
					type: "file",
					notePath: file.path,
					noteName: file.name,
				});
			}),
	);
}

function decodeMarkdownLinkTarget(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

function resolveEmbeddedImageAtCursor(
	host: EditorContextHost,
	editor: Editor,
	sourceFile: TFile,
): TFile | null {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);

	const wikiEmbedRegex = /!\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = wikiEmbedRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (cursor.ch < start || cursor.ch > end) {
			continue;
		}

		const rawTarget = match[1].split("|")[0]?.trim();
		if (!rawTarget) {
			continue;
		}

		const parsed = parseLinktext(rawTarget);
		const embedded = host.app.metadataCache.getFirstLinkpathDest(
			parsed.path,
			sourceFile.path,
		);
		if (embedded instanceof TFile && isImageFile(embedded)) {
			return embedded;
		}
	}

	const markdownImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
	while ((match = markdownImageRegex.exec(line)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (cursor.ch < start || cursor.ch > end) {
			continue;
		}

		let target = match[1].trim();
		if (target.startsWith("<") && target.endsWith(">")) {
			target = target.slice(1, -1).trim();
		}
		if (!target || /^[a-z]+:\/\//i.test(target)) {
			continue;
		}

		const targetWithoutTitle = target.split(/\s+/)[0];
		const decoded = decodeMarkdownLinkTarget(targetWithoutTitle);
		const embedded = host.app.metadataCache.getFirstLinkpathDest(
			decoded,
			sourceFile.path,
		);
		if (embedded instanceof TFile && isImageFile(embedded)) {
			return embedded;
		}
	}

	return null;
}

export function registerEditorContextMenus(host: EditorContextHost): void {
	const workspace = host.app.workspace;

	host.registerEvent(
		workspace.on("editor-menu", (menu: Menu, editor: Editor, info) => {
			const file = info.file;
			if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
				return;
			}

			addSelectionContextMenuItem(host, menu, file, editor);
			addFileContextMenuItem(
				host,
				menu,
				file,
				"Add current file to current chat",
			);

			const embeddedImage = resolveEmbeddedImageAtCursor(host, editor, file);
			if (embeddedImage) {
				addImageFileContextMenuItem(host, menu, embeddedImage);
			}
		}),
	);

	host.registerEvent(
		workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
			if (isContextAttachableFile(file)) {
				addFileContextMenuItem(host, menu, file, "Add file to current chat");
			}

			if (file instanceof TFolder) {
				menu.addItem((item) =>
					item
						.setTitle("Add folder path to current chat")
						.setIcon("folder-plus")
						.onClick(() => {
							void addContextToCurrentChat(host, {
								type: "folder",
								notePath: file.path,
								noteName: file.name,
							});
						}),
				);
			}
		}),
	);
}

export async function addContextToCurrentChat(
	host: EditorContextHost,
	reference: ChatContextReference,
): Promise<boolean> {
	const normalized = normalizeChatContextReference(reference);
	const view = await ensureFocusedView(host);
	if (!view) {
		pluginNotice("Unable to find an active chat view");
		return false;
	}

	return view.addContextReference(normalized);
}

function getMarkdownFilePathForLeaf(leaf: WorkspaceLeaf): string | null {
	const viewState = leaf.getViewState();
	if (viewState.type !== "markdown") {
		return null;
	}

	const state = viewState.state as { file?: unknown } | undefined;
	return typeof state?.file === "string" ? state.file : null;
}

function findExistingLeafForFile(
	app: App,
	filePath: string,
): WorkspaceLeaf | null {
	const mostRecent = app.workspace.getMostRecentLeaf();
	if (mostRecent && getMarkdownFilePathForLeaf(mostRecent) === filePath) {
		return mostRecent;
	}

	let found: WorkspaceLeaf | null = null;
	app.workspace.iterateRootLeaves((leaf) => {
		if (found) {
			return;
		}
		if (getMarkdownFilePathForLeaf(leaf) === filePath) {
			found = leaf;
		}
	});

	if (found) {
		return found;
	}

	app.workspace.iterateAllLeaves((leaf) => {
		if (found) {
			return;
		}
		if (getMarkdownFilePathForLeaf(leaf) === filePath) {
			found = leaf;
		}
	});
	return found;
}

function pickLeafForFileOpen(app: App): WorkspaceLeaf {
	const mostRecent = app.workspace.getMostRecentLeaf();
	if (mostRecent && getMarkdownFilePathForLeaf(mostRecent) !== null) {
		return mostRecent;
	}

	return app.workspace.getLeaf("tab");
}

function clampPosition(editor: Editor, pos: EditorPosition): EditorPosition {
	const lineCount = editor.lineCount();
	const lastLine = Math.max(0, lineCount - 1);
	const line = Math.max(0, Math.min(pos.line, lastLine));
	const lineLength = editor.getLine(line).length;
	const ch = Math.max(0, Math.min(pos.ch, lineLength));
	return { line, ch };
}

function computeSelectionRange(
	editor: Editor,
	selection: { from: EditorPosition; to: EditorPosition },
): { from: EditorPosition; to: EditorPosition } {
	const from = clampPosition(editor, selection.from);
	const to = clampPosition(editor, selection.to);

	// For line-only metadata (e.g. 21-21), expand to visible line highlight.
	if (
		from.ch === 0 &&
		to.ch === 0 &&
		from.line <= to.line &&
		from.line === to.line
	) {
		const lineLength = editor.getLine(from.line).length;
		return {
			from,
			to: {
				line: from.line,
				ch: lineLength,
			},
		};
	}

	if (from.ch === 0 && to.ch === 0 && from.line < to.line) {
		const lastLine = Math.max(0, editor.lineCount() - 1);
		if (to.line < lastLine) {
			return {
				from,
				to: {
					line: to.line + 1,
					ch: 0,
				},
			};
		}
		return {
			from,
			to: {
				line: to.line,
				ch: editor.getLine(to.line).length,
			},
		};
	}

	return { from, to };
}

export async function openContextReferenceInEditor(
	app: App,
	reference: ChatContextReference,
): Promise<void> {
	if (reference.type === "folder") {
		return;
	}

	const file = app.vault.getAbstractFileByPath(reference.notePath);
	if (!(file instanceof TFile)) {
		pluginNotice(`Cannot open missing file: ${reference.notePath}`);
		return;
	}

	const existingLeaf = findExistingLeafForFile(app, file.path);
	const leaf = existingLeaf ?? pickLeafForFileOpen(app);

	if (leaf.isDeferred) {
		await leaf.loadIfDeferred();
	}

	if (getMarkdownFilePathForLeaf(leaf) !== file.path) {
		await leaf.openFile(file);
	}

	await app.workspace.revealLeaf(leaf);
	if (leaf.isDeferred) {
		await leaf.loadIfDeferred();
	}

	let view = leaf.view;
	if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
		await leaf.openFile(file);
		await app.workspace.revealLeaf(leaf);
		view = leaf.view;
	}

	if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
		return;
	}

	const editor = view.editor;

	if (reference.type === "selection" && reference.selection) {
		const normalizedSelection =
			normalizeChatContextReference(reference).selection!;
		const { from, to } = computeSelectionRange(editor, normalizedSelection);
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
		return;
	}

	const pos = { line: 0, ch: 0 };
	editor.setCursor(pos);
	editor.scrollIntoView({ from: pos, to: pos }, true);
}
