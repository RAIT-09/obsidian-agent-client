import { describe, it, expect } from "vitest";
import { formatTabTimestamp } from "../../src/shared/time-utils";

describe("formatTabTimestamp", () => {
	describe("AC: Tab shows agent name + timestamp", () => {
		it("should return a non-empty string for a valid date", () => {
			const date = new Date(2026, 1, 14, 14, 34, 0); // Feb 14, 2026 2:34 PM
			const result = formatTabTimestamp(date);
			expect(result).toBeTruthy();
			expect(result.length).toBeGreaterThan(0);
		});

		it("should include hours and minutes in the output", () => {
			const date = new Date(2026, 1, 14, 14, 34, 0); // 2:34 PM
			const result = formatTabTimestamp(date);
			// Should contain "34" (the minutes) regardless of locale
			expect(result).toContain("34");
		});

		it("should format midnight correctly", () => {
			const date = new Date(2026, 0, 1, 0, 0, 0); // midnight
			const result = formatTabTimestamp(date);
			expect(result).toBeTruthy();
			// Should contain "00" for minutes
			expect(result).toContain("00");
		});

		it("should format noon correctly", () => {
			const date = new Date(2026, 0, 1, 12, 0, 0); // noon
			const result = formatTabTimestamp(date);
			expect(result).toBeTruthy();
			expect(result).toContain("12");
		});

		it("should format single-digit minutes with leading zero", () => {
			const date = new Date(2026, 0, 1, 9, 5, 0); // 9:05
			const result = formatTabTimestamp(date);
			expect(result).toContain("05");
		});

		it("should return consistent results for the same date", () => {
			const date = new Date(2026, 5, 15, 10, 30, 0);
			const result1 = formatTabTimestamp(date);
			const result2 = formatTabTimestamp(date);
			expect(result1).toBe(result2);
		});
	});
});
