import * as React from "react";
const { useRef, useImperativeHandle, useCallback, forwardRef, useEffect } =
	React;
import { setIcon } from "obsidian";

import type { ChatContextReference } from "../../../shared/chat-context-token";
import {
	buildContentFromText,
	createBadgeElement,
	createSlashCommandBadgeElement,
	extractContent,
	findNodeAtPlainTextOffset,
	insertTextAtSelection,
} from "./rich-textarea-dom";

export interface RichTextareaHandle {
	focus(): void;
	insertMentionAtContext(
		name: string,
		contextStart: number,
		contextEnd: number,
	): void;
	insertSlashCommandAtContext(
		commandName: string,
		contextStart: number,
		contextEnd: number,
	): void;
	setContent(text: string): void;
	clear(): void;
	getContentAndCursor(): { text: string; cursorPos: number };
	getElement(): HTMLDivElement | null;
}

interface RichTextareaProps {
	onContentChange: (text: string, cursorPos: number) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
	onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
	placeholder?: string;
	spellCheck?: boolean;
	className?: string;
	onContextBadgeClick?: (reference: ChatContextReference) => void;
}

export const RichTextarea = forwardRef<RichTextareaHandle, RichTextareaProps>(
	function RichTextarea(
		{
			onContentChange,
			onKeyDown,
			onPaste,
			placeholder,
			spellCheck,
			className,
			onContextBadgeClick,
		},
		ref,
	) {
		const editorRef = useRef<HTMLDivElement>(null);
		const isEmptyRef = useRef(true);

		const fireContentChange = useCallback(() => {
			const editor = editorRef.current;
			if (!editor) return;
			const { text, cursorPos } = extractContent(editor);
			isEmptyRef.current = text.trim() === "";
			editor.classList.toggle("obsius-rich-textarea-empty", isEmptyRef.current);
			onContentChange(text, cursorPos);
		}, [onContentChange]);

		const insertMentionAtContext = useCallback(
			(name: string, contextStart: number, contextEnd: number) => {
				const editor = editorRef.current;
				if (!editor) return;

				const startPos = findNodeAtPlainTextOffset(editor, contextStart);
				const endPos = findNodeAtPlainTextOffset(editor, contextEnd);
				if (!startPos || !endPos) return;

				const sel = window.getSelection();
				if (!sel) return;

				const range = document.createRange();
				range.setStart(startPos.node, startPos.offset);
				range.setEnd(endPos.node, endPos.offset);
				range.deleteContents();

				const badge = createBadgeElement(name);
				const space = document.createTextNode(" ");
				range.insertNode(space);
				range.insertNode(badge);

				range.setStartAfter(space);
				range.setEndAfter(space);
				sel.removeAllRanges();
				sel.addRange(range);

				fireContentChange();
			},
			[fireContentChange],
		);

		const insertSlashCommandAtContext = useCallback(
			(commandName: string, contextStart: number, contextEnd: number) => {
				const editor = editorRef.current;
				if (!editor) return;

				const startPos = findNodeAtPlainTextOffset(editor, contextStart);
				const endPos = findNodeAtPlainTextOffset(editor, contextEnd);
				if (!startPos || !endPos) return;

				const sel = window.getSelection();
				if (!sel) return;

				const range = document.createRange();
				range.setStart(startPos.node, startPos.offset);
				range.setEnd(endPos.node, endPos.offset);
				range.deleteContents();

				const badge = createSlashCommandBadgeElement(commandName);
				const space = document.createTextNode(" ");
				range.insertNode(space);
				range.insertNode(badge);

				range.setStartAfter(space);
				range.setEndAfter(space);
				sel.removeAllRanges();
				sel.addRange(range);

				fireContentChange();
			},
			[fireContentChange],
		);

		useImperativeHandle(
			ref,
			() => ({
				focus: () => editorRef.current?.focus(),
				insertMentionAtContext,
				insertSlashCommandAtContext,
				setContent: (text: string) => {
					if (editorRef.current) {
						buildContentFromText(
							editorRef.current,
							text,
							true,
							onContextBadgeClick,
						);
						fireContentChange();
					}
				},
				clear: () => {
					if (editorRef.current) {
						editorRef.current.innerHTML = "";
						editorRef.current.appendChild(document.createTextNode(""));
						isEmptyRef.current = true;
						editorRef.current.classList.add("obsius-rich-textarea-empty");
						fireContentChange();
					}
				},
				getContentAndCursor: () => {
					if (!editorRef.current) return { text: "", cursorPos: 0 };
					return extractContent(editorRef.current);
				},
				getElement: () => editorRef.current,
			}),
			[insertMentionAtContext, insertSlashCommandAtContext, fireContentChange, onContextBadgeClick],
		);

		const handleInput = useCallback(() => {
			fireContentChange();
		}, [fireContentChange]);

		const handlePaste = useCallback(
			(e: React.ClipboardEvent<HTMLDivElement>) => {
				const text = e.clipboardData.getData("text/plain");
				if (text) {
					e.preventDefault();
					insertTextAtSelection(text);
				}
				onPaste?.(e);
			},
			[onPaste],
		);

		useEffect(() => {
			const editor = editorRef.current;
			if (!editor) return;
			if (editor.childNodes.length === 0) {
				editor.appendChild(document.createTextNode(""));
				editor.classList.add("obsius-rich-textarea-empty");
			}
		}, []);

		// Render Obsidian icons inside badge elements via setIcon
		useEffect(() => {
			const editor = editorRef.current;
			if (!editor) return;

			function renderIcons(root: HTMLElement) {
				const icons = Array.from(
					root.querySelectorAll(".obsius-inline-mention-icon[data-icon]"),
				);
				for (const el of icons) {
					if (el.children.length > 0) continue;
					const iconName = (el as HTMLElement).dataset.icon;
					if (!iconName) continue;
					try {
						setIcon(el as HTMLElement, iconName);
					} catch {
						el.textContent = "📄";
					}
				}
			}

			const observer = new MutationObserver(() => renderIcons(editor));
			observer.observe(editor, { childList: true, subtree: true });
			renderIcons(editor);

			return () => observer.disconnect();
		}, []);

		return (
			<div
				ref={editorRef}
				contentEditable
				onInput={handleInput}
				onKeyDown={onKeyDown}
				onPaste={handlePaste}
				spellCheck={spellCheck}
				className={`obsius-rich-textarea ${className ?? ""} obsius-rich-textarea-empty`}
				data-placeholder={placeholder}
				role="textbox"
				aria-multiline="true"
			/>
		);
	},
);
