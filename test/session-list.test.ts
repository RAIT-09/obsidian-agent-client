import { describe, it, expect } from "vitest";
import {
	appendUniqueSessions,
	filterSessionsByTitle,
	formatPageRange,
	getPageWindow,
	nextPageCursor,
	parseSearchQuery,
	shouldFetchNextPage,
} from "../src/utils/session-list";

const s = (sessionId: string, title?: string) => ({
	sessionId,
	cwd: "/vault",
	title,
});

describe("appendUniqueSessions", () => {
	it("appends a page in order", () => {
		const out = appendUniqueSessions([s("a"), s("b")], [s("c"), s("d")]);
		expect(out.map((x) => x.sessionId)).toEqual(["a", "b", "c", "d"]);
	});

	it("skips rows repeated from the previous page (shifted offset)", () => {
		const out = appendUniqueSessions([s("a"), s("b")], [s("b"), s("c")]);
		expect(out.map((x) => x.sessionId)).toEqual(["a", "b", "c"]);
	});

	it("skips duplicates within the page itself", () => {
		const out = appendUniqueSessions([s("a")], [s("c"), s("c")]);
		expect(out.map((x) => x.sessionId)).toEqual(["a", "c"]);
	});

	it("keeps the existing row, not the repeated one", () => {
		const existing = [s("a", "renamed")];
		const out = appendUniqueSessions(existing, [s("a", "stale")]);
		expect(out[0].title).toBe("renamed");
	});

	it("returns the same array when nothing is new", () => {
		const existing = [s("a")];
		expect(appendUniqueSessions(existing, [s("a")])).toBe(existing);
		expect(appendUniqueSessions(existing, [])).toBe(existing);
	});
});

describe("parseSearchQuery", () => {
	it("splits on whitespace and drops empty terms", () => {
		expect(parseSearchQuery("  hover   Preview ")).toEqual([
			"hover",
			"preview",
		]);
	});

	it("treats the ideographic space as a separator", () => {
		expect(parseSearchQuery("設定　画面")).toEqual(["設定", "画面"]);
	});

	it("returns no terms for a blank query", () => {
		expect(parseSearchQuery("")).toEqual([]);
		expect(parseSearchQuery(" \t ")).toEqual([]);
	});
});

describe("filterSessionsByTitle", () => {
	const sessions = [
		s("1", "Fix hover link preview"),
		s("2", "Session history paging"),
		s("3", "ACP の設定画面"),
		s("4"),
	];
	const ids = (query: string) =>
		filterSessionsByTitle(sessions, query).map((x) => x.sessionId);

	it("returns the input array for a blank query", () => {
		expect(filterSessionsByTitle(sessions, "  ")).toBe(sessions);
	});

	it("matches case-insensitively", () => {
		expect(ids("HOVER")).toEqual(["1"]);
	});

	it("requires every term, in any order", () => {
		expect(ids("preview hover")).toEqual(["1"]);
		expect(ids("hover paging")).toEqual([]);
	});

	it("folds full-width ASCII to half-width", () => {
		expect(ids("ａｃｐ")).toEqual(["3"]);
	});

	it("matches Japanese substrings", () => {
		expect(ids("設定")).toEqual(["3"]);
	});

	it("searches the displayed fallback for untitled sessions", () => {
		expect(ids("untitled")).toEqual(["4"]);
	});
});

describe("getPageWindow", () => {
	it("slices full and partial pages", () => {
		expect(getPageWindow(120, 0, 50)).toEqual({
			page: 0,
			pageCount: 3,
			start: 0,
			end: 50,
		});
		expect(getPageWindow(120, 2, 50)).toEqual({
			page: 2,
			pageCount: 3,
			start: 100,
			end: 120,
		});
	});

	it("has a single empty page for an empty list", () => {
		expect(getPageWindow(0, 0, 50)).toEqual({
			page: 0,
			pageCount: 1,
			start: 0,
			end: 0,
		});
	});

	it("clamps a page past the end to the last page", () => {
		// e.g. the last row of page 3 was deleted
		expect(getPageWindow(100, 2, 50)).toEqual({
			page: 1,
			pageCount: 2,
			start: 50,
			end: 100,
		});
	});

	it("clamps a negative page to the first page", () => {
		expect(getPageWindow(10, -1, 50).page).toBe(0);
	});
});

describe("formatPageRange", () => {
	it("labels the rows of a page", () => {
		expect(formatPageRange(getPageWindow(120, 1, 50), 120, false)).toBe(
			"51–100 of 120",
		);
	});

	it("marks the total as a lower bound while the agent has more", () => {
		expect(formatPageRange(getPageWindow(1000, 0, 50), 1000, true)).toBe(
			"1–50 of 1000+",
		);
	});

	it("labels an empty list", () => {
		expect(formatPageRange(getPageWindow(0, 0, 50), 0, true)).toBe(
			"0 of 0+",
		);
	});
});

describe("shouldFetchNextPage", () => {
	const idle = {
		hasMore: true,
		loading: false,
		failed: false,
		onLastLoadedPage: false,
		filtering: false,
	};

	it("fetches when the last loaded page is showing", () => {
		expect(shouldFetchNextPage({ ...idle, onLastLoadedPage: true })).toBe(
			true,
		);
	});

	it("waits for the pager otherwise", () => {
		expect(shouldFetchNextPage(idle)).toBe(false);
	});

	it("keeps fetching while a filter is on, wherever the pager is", () => {
		// e.g. a search with more than a page of matches loaded
		expect(shouldFetchNextPage({ ...idle, filtering: true })).toBe(true);
	});

	it("never fetches with nothing left, a request running, or a failure", () => {
		const wanted = { ...idle, onLastLoadedPage: true, filtering: true };
		expect(shouldFetchNextPage({ ...wanted, hasMore: false })).toBe(false);
		expect(shouldFetchNextPage({ ...wanted, loading: true })).toBe(false);
		// A failed page waits for Retry instead of looping
		expect(shouldFetchNextPage({ ...wanted, failed: true })).toBe(false);
	});
});

describe("nextPageCursor", () => {
	it("pages on with a cursor not used yet", () => {
		expect(nextPageCursor("B", new Set(["A"]))).toBe("B");
	});

	it("ends the listing on the cursor just used", () => {
		expect(nextPageCursor("A", new Set(["A"]))).toBeUndefined();
	});

	it("ends the listing on a cursor used earlier (A → B → A)", () => {
		expect(nextPageCursor("A", new Set(["A", "B"]))).toBeUndefined();
	});

	it("keeps the end of the listing as the end", () => {
		expect(nextPageCursor(undefined, new Set(["A"]))).toBeUndefined();
	});
});
