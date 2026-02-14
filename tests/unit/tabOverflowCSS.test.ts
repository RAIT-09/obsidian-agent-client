import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests for User Story: Tab Overflow with Shrinking - CSS Verification
 *
 * These tests verify that the styles.css file contains the critical CSS
 * properties required for the tab overflow with shrinking behavior.
 *
 * Acceptance Criteria verified via CSS:
 * - Tabs shrink in width (flex: 1 1 0, min-width: 80px)
 * - Tab labels truncate with ellipsis (text-overflow: ellipsis)
 * - All tabs remain visible (overflow: hidden on container)
 */

const cssContent = readFileSync(
	resolve(__dirname, "../../styles.css"),
	"utf-8",
);

describe("Tab Overflow CSS - styles.css verification", () => {
	// ========================================================================
	// AC: Tabs shrink in width as more tabs are added (min width: 80px)
	// ========================================================================
	describe("AC: Tab bar uses flex layout for shrinking tabs", () => {
		it("should define .agent-client-tab-bar with display: flex", () => {
			// Extract the .agent-client-tab-bar block
			const tabBarMatch = cssContent.match(
				/\.agent-client-tab-bar\s*\{[^}]*\}/,
			);
			expect(tabBarMatch).not.toBeNull();
			expect(tabBarMatch![0]).toContain("display: flex");
		});

		it("should define .agent-client-tab with flex: 1 1 0 for equal shrinking", () => {
			// Extract the base .agent-client-tab block (not pseudo-classes)
			const tabMatch = cssContent.match(
				/\.agent-client-tab\s*\{[^}]*\}/,
			);
			expect(tabMatch).not.toBeNull();
			expect(tabMatch![0]).toMatch(/flex:\s*1\s+1\s+0/);
		});

		it("should define .agent-client-tab with min-width: 80px", () => {
			const tabMatch = cssContent.match(
				/\.agent-client-tab\s*\{[^}]*\}/,
			);
			expect(tabMatch).not.toBeNull();
			expect(tabMatch![0]).toContain("min-width: 80px");
		});

		it("should define .agent-client-tab with max-width: 200px", () => {
			const tabMatch = cssContent.match(
				/\.agent-client-tab\s*\{[^}]*\}/,
			);
			expect(tabMatch).not.toBeNull();
			expect(tabMatch![0]).toContain("max-width: 200px");
		});

		it("should define .agent-client-tab with overflow: hidden", () => {
			const tabMatch = cssContent.match(
				/\.agent-client-tab\s*\{[^}]*\}/,
			);
			expect(tabMatch).not.toBeNull();
			expect(tabMatch![0]).toContain("overflow: hidden");
		});
	});

	// ========================================================================
	// AC: Tab labels truncate with ellipsis (...) when too narrow
	// ========================================================================
	describe("AC: Tab labels use text-overflow: ellipsis for truncation", () => {
		it("should define .agent-client-tab-label with text-overflow: ellipsis", () => {
			const labelMatch = cssContent.match(
				/\.agent-client-tab-label\s*\{[^}]*\}/,
			);
			expect(labelMatch).not.toBeNull();
			expect(labelMatch![0]).toContain("text-overflow: ellipsis");
		});

		it("should define .agent-client-tab-label with white-space: nowrap", () => {
			const labelMatch = cssContent.match(
				/\.agent-client-tab-label\s*\{[^}]*\}/,
			);
			expect(labelMatch).not.toBeNull();
			expect(labelMatch![0]).toContain("white-space: nowrap");
		});

		it("should define .agent-client-tab-label with overflow: hidden", () => {
			const labelMatch = cssContent.match(
				/\.agent-client-tab-label\s*\{[^}]*\}/,
			);
			expect(labelMatch).not.toBeNull();
			expect(labelMatch![0]).toContain("overflow: hidden");
		});
	});

	// ========================================================================
	// AC: All tabs remain visible (no scrolling)
	// ========================================================================
	describe("AC: Tab bar uses overflow: hidden to prevent scrolling", () => {
		it("should define .agent-client-tab-bar with overflow: hidden", () => {
			const tabBarMatch = cssContent.match(
				/\.agent-client-tab-bar\s*\{[^}]*\}/,
			);
			expect(tabBarMatch).not.toBeNull();
			expect(tabBarMatch![0]).toContain("overflow: hidden");
		});

		it("should NOT use overflow: scroll or overflow: auto on the tab bar", () => {
			const tabBarMatch = cssContent.match(
				/\.agent-client-tab-bar\s*\{[^}]*\}/,
			);
			expect(tabBarMatch).not.toBeNull();
			expect(tabBarMatch![0]).not.toContain("overflow: scroll");
			expect(tabBarMatch![0]).not.toContain("overflow: auto");
			expect(tabBarMatch![0]).not.toContain("overflow-x: scroll");
			expect(tabBarMatch![0]).not.toContain("overflow-x: auto");
		});
	});
});
