import { describe, it, expect } from "vitest";
import {
	buildPromptInjectionInstructions,
	promptInjectionForPrompts,
} from "../src/utils/prompt-injection";

const allOn = { enabled: true, latex: true, wikiLinks: true, tables: true };
const [WIKI, TABLES, LATEX] = buildPromptInjectionInstructions(allOn);

describe("buildPromptInjectionInstructions", () => {
	it("lists the instructions turned on, in a fixed order", () => {
		expect(WIKI).toMatch(/^When referencing notes/);
		expect(TABLES).toMatch(/^Always leave a blank line/);
		expect(LATEX).toMatch(/^This client uses Obsidian Flavored Markdown/);
		expect(
			buildPromptInjectionInstructions({ ...allOn, wikiLinks: false }),
		).toEqual([TABLES, LATEX]);
	});

	it("has none when injection is off", () => {
		expect(
			buildPromptInjectionInstructions({ ...allOn, enabled: false }),
		).toEqual([]);
	});
});

describe("promptInjectionForPrompts", () => {
	it("carries all of them when the system prompt has none", () => {
		expect(promptInjectionForPrompts(allOn, [])).toEqual([
			WIKI,
			TABLES,
			LATEX,
		]);
	});

	it("carries only those turned on since the system prompt was set", () => {
		expect(promptInjectionForPrompts(allOn, [WIKI, TABLES])).toEqual([
			LATEX,
		]);
		expect(
			promptInjectionForPrompts({ ...allOn, latex: false }, [
				WIKI,
				TABLES,
				LATEX,
			]),
		).toEqual([]);
	});
});
