const ELLIPSIS = "...";

/**
 * Truncate a string so its final length (including ellipsis) does not
 * exceed `maxLength`. If `text` already fits, it is returned as-is.
 *
 * For `maxLength <= ELLIPSIS.length`, the ellipsis is omitted to honor
 * the length contract — a small but well-defined edge case.
 */
export function truncateTitle(text: string, maxLength = 50): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= ELLIPSIS.length) return text.slice(0, maxLength);
	return text.slice(0, maxLength - ELLIPSIS.length) + ELLIPSIS;
}
