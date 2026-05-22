/**
 * Truncate a string to a maximum length, appending an ellipsis if cut.
 */
export function truncateTitle(text: string, maxLength = 50): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + "...";
}
