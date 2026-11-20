/**
 * Prompt injection: short instructions that make agents write Obsidian
 * Flavored Markdown. AcpClient puts them in the system prompt of a session it
 * starts, when the agent takes one (`sessionCapabilities.systemPrompt`);
 * preparePrompt puts those a session's system prompt lacks in its first
 * prompt.
 */

/** The prompt-injection settings (`settings.promptInjection`) */
export interface PromptInjectionSettings {
	enabled: boolean;
	latex: boolean;
	wikiLinks: boolean;
	tables: boolean;
}

const WIKI_LINK_INSTRUCTION =
	"When referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.";
const TABLE_INSTRUCTION =
	"Always leave a blank line before Markdown tables; without it Obsidian renders them as plain text.";
const LATEX_MATH_INSTRUCTION =
	"This client uses Obsidian Flavored Markdown. For math, use $...$ for inline and $$...$$ for display (not \\(...\\) or \\[...\\]).";

/** The instructions the settings turn on; none when injection is off. */
export function buildPromptInjectionInstructions(
	settings: PromptInjectionSettings,
): string[] {
	if (!settings.enabled) return [];
	return [
		...(settings.wikiLinks ? [WIKI_LINK_INSTRUCTION] : []),
		...(settings.tables ? [TABLE_INSTRUCTION] : []),
		...(settings.latex ? [LATEX_MATH_INSTRUCTION] : []),
	];
}

/**
 * The instructions a session's prompts have to carry: those the settings turn
 * on that its system prompt lacks. A session gets its system prompt when it
 * starts, so it lacks those turned on since, and all of them when the agent
 * takes no system prompt.
 */
export function promptInjectionForPrompts(
	settings: PromptInjectionSettings,
	inSystemPrompt: readonly string[],
): string[] {
	return buildPromptInjectionInstructions(settings).filter(
		(instruction) => !inSystemPrompt.includes(instruction),
	);
}
