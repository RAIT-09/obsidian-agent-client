/**
 * Pure helpers for the Session History list: appending agent pages, title
 * search, and paging.
 */

/** Title shown (and searched) for a session that has none. */
export const UNTITLED_SESSION_TITLE = "Untitled Session";

/** Rows rendered per page in the Session History modal. */
export const SESSION_HISTORY_PAGE_SIZE = 50;

/**
 * Append a session/list page, skipping sessions already listed. Offset
 * cursors shift when a session is created between two page requests, so the
 * next page can repeat the previous page's last rows; a duplicate would show
 * twice and collide on its React key.
 */
export function appendUniqueSessions<T extends { sessionId: string }>(
	existing: T[],
	page: T[],
): T[] {
	const seen = new Set(existing.map((s) => s.sessionId));
	const fresh = page.filter((s) => {
		if (seen.has(s.sessionId)) return false;
		seen.add(s.sessionId);
		return true;
	});
	return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/**
 * The cursor to fetch the next session/list page with, or undefined to end
 * the listing. The history modal pulls pages on its own, so an agent that
 * hands back a cursor it already gave for this listing (the one just used,
 * or an earlier one: A → B → A) would have it paging round in a circle.
 *
 * @param returned - The page's `nextCursor`
 * @param used - The cursors already used for this listing, including the
 *   one this page was fetched with
 */
export function nextPageCursor(
	returned: string | undefined,
	used: ReadonlySet<string>,
): string | undefined {
	return returned !== undefined && used.has(returned) ? undefined : returned;
}

/**
 * Fold text for matching: NFKC maps full-width ASCII and the ideographic
 * space (common with Japanese IMEs) to their half-width forms, so "ＡＣＰ"
 * finds "ACP"; lower-casing makes the match case-insensitive.
 */
function foldForSearch(text: string): string {
	return text.normalize("NFKC").toLowerCase();
}

/** Split a search query into folded, non-empty terms. */
export function parseSearchQuery(query: string): string[] {
	return foldForSearch(query)
		.split(/\s+/)
		.filter((term) => term.length > 0);
}

/**
 * Keep the sessions whose title contains every term of `query`, in any
 * order. The title searched is the one displayed, so a session without a
 * title matches "untitled". A blank query returns `sessions` itself.
 */
export function filterSessionsByTitle<T extends { title?: string }>(
	sessions: T[],
	query: string,
): T[] {
	const terms = parseSearchQuery(query);
	if (terms.length === 0) return sessions;
	return sessions.filter((session) => {
		const title = foldForSearch(session.title ?? UNTITLED_SESSION_TITLE);
		return terms.every((term) => title.includes(term));
	});
}

/** The slice of a list that one page shows. */
export interface PageWindow {
	/** 0-based page index, clamped into range */
	page: number;
	/** Number of pages; at least 1, so an empty list still has page 0 */
	pageCount: number;
	/** Index of the first row on the page (inclusive) */
	start: number;
	/** Index after the last row on the page (exclusive) */
	end: number;
}

/**
 * Compute the rows `page` shows out of `total`. The page is clamped, so a
 * page that no longer exists (e.g. after deleting the last row on it)
 * resolves to the last page instead of an empty one.
 */
export function getPageWindow(
	total: number,
	page: number,
	pageSize: number,
): PageWindow {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const clamped = Math.min(Math.max(0, page), pageCount - 1);
	const start = clamped * pageSize;
	return {
		page: clamped,
		pageCount,
		start,
		end: Math.min(start + pageSize, total),
	};
}

/**
 * Whether the history modal should fetch the agent's next session/list page
 * now: while the last loaded page is showing (so "Next" has a page to
 * reveal), and all the way to the end while a filter is on (a search, or
 * hiding sessions without local data), so the filter covers the whole
 * history rather than only the pages fetched so far. Never while a request
 * is running or after one failed: a failed page waits for the user's Retry.
 */
export function shouldFetchNextPage(state: {
	hasMore: boolean;
	loading: boolean;
	failed: boolean;
	onLastLoadedPage: boolean;
	filtering: boolean;
}): boolean {
	return (
		state.hasMore &&
		!state.loading &&
		!state.failed &&
		(state.onLastLoadedPage || state.filtering)
	);
}

/**
 * Label a page's rows, e.g. "51–100 of 312". `hasMore` marks the total as
 * a lower bound ("of 1000+") while the agent still has unloaded pages.
 */
export function formatPageRange(
	window: PageWindow,
	total: number,
	hasMore: boolean,
): string {
	const of = `${total}${hasMore ? "+" : ""}`;
	if (total === 0) return `0 of ${of}`;
	return `${window.start + 1}–${window.end} of ${of}`;
}
