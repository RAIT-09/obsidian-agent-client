import { getFileIcon } from "./file-icons";
import {
	createChatContextToken,
	formatChatContextBadgeLabel,
	formatChatContextTooltip,
	parseChatContextToken,
	type ChatContextReference,
} from "../../../shared/chat-context-token";
import { parseSlashCommandToken } from "../../../shared/slash-command-token";

export function createBadgeElement(name: string): HTMLSpanElement {
	const badge = document.createElement("span");
	badge.className = "obsius-inline-mention-badge";
	badge.contentEditable = "false";
	badge.dataset.mention = name;

	const icon = document.createElement("span");
	icon.className = "obsius-inline-mention-icon";
	const iconName = getFileIcon(name);
	icon.dataset.icon = iconName;
	icon.textContent = "";
	badge.appendChild(icon);

	const nameSpan = document.createElement("span");
	nameSpan.className = "obsius-inline-mention-name";
	nameSpan.textContent = name;
	badge.appendChild(nameSpan);

	return badge;
}

export function createContextBadgeElement(
	reference: ChatContextReference,
	onContextBadgeClick?: (reference: ChatContextReference) => void,
): HTMLSpanElement {
	const badge = document.createElement("span");
	const typeClass = `obsius-inline-context-badge-${reference.type}`;
	const canOpenInEditor = reference.type !== "folder";
	badge.className = [
		"obsius-inline-mention-badge",
		"obsius-inline-context-badge",
		typeClass,
		canOpenInEditor ? "obsius-inline-context-badge-clickable" : "",
	]
		.filter(Boolean)
		.join(" ");
	badge.contentEditable = "false";

	const token = createChatContextToken(reference);
	badge.dataset.contextToken = token;
	badge.dataset.contextPath = reference.notePath;
	badge.dataset.contextType = reference.type;
	badge.title = formatChatContextTooltip(reference);

	const icon = document.createElement("span");
	icon.className = "obsius-inline-mention-icon";
	if (reference.type === "folder") {
		icon.dataset.icon = "folder";
	} else if (reference.type === "selection") {
		icon.dataset.icon = "list";
	} else {
		icon.dataset.icon = getFileIcon(reference.notePath);
	}
	icon.textContent = "";
	badge.appendChild(icon);

	const nameSpan = document.createElement("span");
	nameSpan.className = "obsius-inline-mention-name";
	nameSpan.textContent = formatChatContextBadgeLabel(reference);
	badge.appendChild(nameSpan);

	if (onContextBadgeClick && canOpenInEditor) {
		badge.tabIndex = 0;
		badge.setAttribute("role", "button");
		badge.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onContextBadgeClick(reference);
		});
		badge.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				event.stopPropagation();
				onContextBadgeClick(reference);
			}
		});
	}

	return badge;
}

export function createSlashCommandBadgeElement(
	commandName: string,
): HTMLSpanElement {
	const badge = document.createElement("span");
	badge.className = "obsius-inline-mention-badge obsius-inline-slash-badge";
	badge.contentEditable = "false";
	badge.dataset.slashCommand = commandName;

	const icon = document.createElement("span");
	icon.className = "obsius-inline-mention-icon";
	icon.dataset.icon = "terminal";
	icon.textContent = "";
	badge.appendChild(icon);

	const nameSpan = document.createElement("span");
	nameSpan.className = "obsius-inline-mention-name";
	nameSpan.textContent = `/${commandName}`;
	badge.appendChild(nameSpan);

	return badge;
}

export function extractContent(editor: HTMLDivElement): {
	text: string;
	cursorPos: number;
} {
	const selection = window.getSelection();
	const focusNode = selection?.focusNode ?? null;
	const focusOffset = selection?.focusOffset ?? 0;

	let text = "";
	let cursorPos = 0;
	let foundCursor = false;

	function walk(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			const content = node.textContent ?? "";
			if (!foundCursor && node === focusNode) {
				cursorPos = text.length + focusOffset;
				foundCursor = true;
			}
			text += content;
		} else if (node instanceof HTMLElement) {
			if (node.dataset.contextToken) {
				const contextToken = node.dataset.contextToken;
				if (!contextToken) {
					return;
				}
				if (!foundCursor && (node === focusNode || node.contains(focusNode))) {
					cursorPos = text.length + contextToken.length;
					foundCursor = true;
				}
				text += contextToken;
			} else if (node.dataset.slashCommand) {
				const slashToken = `@[obsius-slash:${node.dataset.slashCommand}]`;
				if (!foundCursor && (node === focusNode || node.contains(focusNode))) {
					cursorPos = text.length + slashToken.length;
					foundCursor = true;
				}
				text += slashToken;
			} else if (node.dataset.mention) {
				const mentionText = `@[[${node.dataset.mention}]]`;
				if (!foundCursor && (node === focusNode || node.contains(focusNode))) {
					cursorPos = text.length + mentionText.length;
					foundCursor = true;
				}
				text += mentionText;
			} else if (node.tagName === "BR") {
				if (!foundCursor && node === focusNode) {
					cursorPos = text.length;
					foundCursor = true;
				}
				text += "\n";
			} else {
				Array.from(node.childNodes).forEach(walk);
			}
		}
	}

	Array.from(editor.childNodes).forEach(walk);

	if (!foundCursor) {
		cursorPos = text.length;
	}

	return { text, cursorPos };
}

export function buildContentFromText(
	editor: HTMLDivElement,
	text: string,
	cursorAtEnd = true,
	onContextBadgeClick?: (reference: ChatContextReference) => void,
): void {
	editor.innerHTML = "";

	const regex =
		/@\[obsius-context:[A-Za-z0-9_-]+\]|@\[obsius-slash:([^\]]+)\]|@\[\[([^\]]+)\]\]/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			editor.appendChild(
				document.createTextNode(text.slice(lastIndex, match.index)),
			);
		}

		const token = match[0];
		if (token.startsWith("@[obsius-context:")) {
			const contextReference = parseChatContextToken(token);
			if (contextReference) {
				editor.appendChild(
					createContextBadgeElement(contextReference, onContextBadgeClick),
				);
			} else {
				editor.appendChild(document.createTextNode(token));
			}
		} else if (token.startsWith("@[obsius-slash:")) {
			const cmdName = parseSlashCommandToken(token);
			if (cmdName) {
				editor.appendChild(createSlashCommandBadgeElement(cmdName));
			} else {
				editor.appendChild(document.createTextNode(token));
			}
		} else {
			editor.appendChild(createBadgeElement(match[2] ?? match[1]));
		}
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < text.length) {
		editor.appendChild(document.createTextNode(text.slice(lastIndex)));
	}

	if (editor.childNodes.length === 0) {
		editor.appendChild(document.createTextNode(""));
	}

	if (cursorAtEnd) {
		const sel = window.getSelection();
		if (sel) {
			const range = document.createRange();
			const lastChild = editor.lastChild;
			if (!lastChild) {
				return;
			}
			if (lastChild.nodeType === Node.TEXT_NODE) {
				range.setStart(lastChild, lastChild.textContent?.length ?? 0);
			} else {
				range.setStartAfter(lastChild);
			}
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}
}

/**
 * Walk the editor DOM to find the text node and offset corresponding
 * to a given plain-text position (where badges count as @[[name]]).
 */
export function findNodeAtPlainTextOffset(
	editor: HTMLDivElement,
	targetOffset: number,
): { node: Node; offset: number } | null {
	let accumulated = 0;

	const children = Array.from(editor.childNodes);
	for (const child of children) {
		if (child.nodeType === Node.TEXT_NODE) {
			const len = child.textContent?.length ?? 0;
			if (accumulated + len >= targetOffset) {
				return { node: child, offset: targetOffset - accumulated };
			}
			accumulated += len;
		} else if (child instanceof HTMLElement && child.dataset.slashCommand) {
			const slashLen = `@[obsius-slash:${child.dataset.slashCommand}]`.length;
			if (accumulated + slashLen >= targetOffset) {
				const next = child.nextSibling;
				if (next) return { node: next, offset: 0 };
				return null;
			}
			accumulated += slashLen;
		} else if (child instanceof HTMLElement && child.dataset.mention) {
			const mentionLen = `@[[${child.dataset.mention}]]`.length;
			if (accumulated + mentionLen >= targetOffset) {
				const next = child.nextSibling;
				if (next) return { node: next, offset: 0 };
				return null;
			}
			accumulated += mentionLen;
		} else if (child instanceof HTMLElement && child.dataset.contextToken) {
			const contextToken = child.dataset.contextToken;
			if (!contextToken) {
				continue;
			}
			const contextTokenLength = contextToken.length;
			if (accumulated + contextTokenLength >= targetOffset) {
				const next = child.nextSibling;
				if (next) return { node: next, offset: 0 };
				return null;
			}
			accumulated += contextTokenLength;
		} else if (child instanceof HTMLElement && child.tagName === "BR") {
			if (accumulated + 1 >= targetOffset) {
				const next = child.nextSibling;
				if (next) return { node: next, offset: 0 };
				return null;
			}
			accumulated += 1;
		}
	}

	const last = editor.lastChild;
	if (last && last.nodeType === Node.TEXT_NODE) {
		return { node: last, offset: last.textContent?.length ?? 0 };
	}
	return null;
}

export function insertTextAtSelection(text: string): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return;
	}

	const range = selection.getRangeAt(0);
	range.deleteContents();
	const textNode = document.createTextNode(text);
	range.insertNode(textNode);
	range.setStartAfter(textNode);
	range.setEndAfter(textNode);
	selection.removeAllRanges();
	selection.addRange(range);
}
