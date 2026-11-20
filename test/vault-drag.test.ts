import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import type { App, Draggable, TAbstractFile } from "obsidian";
import {
	collectVaultDragFiles,
	getVaultDragFiles,
	mimeTypeFromExtension,
} from "../src/utils/vault-drag";

// Fixtures mimic Obsidian's DragManager payloads (see
// src/types/obsidian-internals.d.ts). Files are real stub-TFile instances so
// the `instanceof TFile` narrowing holds; folders are plain objects, which is
// all the classifier needs to tell them apart.

function tfile(path: string): TFile {
	const name = path.split("/").pop()!;
	return new TFile(path, name.replace(/\.[^.]*$/, ""));
}

function folder(path: string): TAbstractFile {
	return { path, name: path.split("/").pop()! } as unknown as TAbstractFile;
}

describe("collectVaultDragFiles", () => {
	it("routes a single markdown note to notes", () => {
		const note = tfile("dir/Note.md");
		const result = collectVaultDragFiles({ type: "file", file: note });
		expect(result).toEqual({ notes: [note], files: [], skippedCount: 0 });
	});

	it("routes a single non-markdown file to files", () => {
		const pdf = tfile("papers/report.pdf");
		const result = collectVaultDragFiles({ type: "file", file: pdf });
		expect(result).toEqual({ notes: [], files: [pdf], skippedCount: 0 });
	});

	it("splits a multi-selection and counts folders as skipped", () => {
		const note = tfile("a.md");
		const csv = tfile("data/table.csv");
		const png = tfile("img/pic.png");
		const result = collectVaultDragFiles({
			type: "files",
			files: [note, folder("data"), csv, png],
		});
		expect(result).toEqual({
			notes: [note],
			files: [csv, png],
			skippedCount: 1,
		});
	});

	it("accepts a resolved link drag", () => {
		const pdf = tfile("doc.pdf");
		const draggable = {
			type: "link",
			file: pdf,
			linktext: "doc.pdf",
		} as Draggable;
		expect(collectVaultDragFiles(draggable)?.files).toEqual([pdf]);
	});

	it("returns null for drags that carry no vault file", () => {
		expect(collectVaultDragFiles(null)).toBeNull();
		expect(collectVaultDragFiles(undefined)).toBeNull();
		// Folder-only drags
		expect(
			collectVaultDragFiles({ type: "folder", file: folder("dir") }),
		).toBeNull();
		expect(
			collectVaultDragFiles({ type: "files", files: [folder("dir")] }),
		).toBeNull();
		// Unresolved link
		expect(collectVaultDragFiles({ type: "link", file: null })).toBeNull();
		// Unrelated drag types (tabs, bookmarks, ...)
		expect(collectVaultDragFiles({ type: "bookmarks" })).toBeNull();
	});
});

describe("getVaultDragFiles", () => {
	it("reads the in-progress drag from app.dragManager", () => {
		const pdf = tfile("x.pdf");
		const app = {
			dragManager: { draggable: { type: "file", file: pdf } },
		} as unknown as App;
		expect(getVaultDragFiles(app)?.files).toEqual([pdf]);
	});

	it("tolerates a missing drag manager or no active drag", () => {
		expect(getVaultDragFiles({} as App)).toBeNull();
		const idle = { dragManager: { draggable: null } } as unknown as App;
		expect(getVaultDragFiles(idle)).toBeNull();
	});
});

describe("mimeTypeFromExtension", () => {
	it("maps common document and image extensions", () => {
		expect(mimeTypeFromExtension("pdf")).toBe("application/pdf");
		expect(mimeTypeFromExtension("csv")).toBe("text/csv");
		expect(mimeTypeFromExtension("jpg")).toBe("image/jpeg");
		expect(mimeTypeFromExtension("PNG")).toBe("image/png");
	});

	it("falls back to application/octet-stream", () => {
		expect(mimeTypeFromExtension("xyz")).toBe("application/octet-stream");
		expect(mimeTypeFromExtension("")).toBe("application/octet-stream");
	});

	it.each(["__proto__", "constructor"])(
		"falls back for inherited property %s",
		(extension) => {
			expect(mimeTypeFromExtension(extension)).toBe(
				"application/octet-stream",
			);
		},
	);
});
