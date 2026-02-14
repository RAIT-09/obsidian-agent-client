/**
 * Format a date as a tab timestamp (e.g., "2:34 PM", "14:34")
 * Uses browser's locale for 12/24-hour format
 */
export function formatTabTimestamp(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}
