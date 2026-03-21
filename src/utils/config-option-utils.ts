import type {
	SessionConfigSelectGroup,
	SessionConfigSelectOption,
} from "../types/session";

/**
 * Flatten config select options, handling both flat and grouped options.
 */
export function flattenConfigSelectOptions(
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
	if (options.length === 0) return [];
	if ("value" in options[0]) return options as SessionConfigSelectOption[];
	return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
}
