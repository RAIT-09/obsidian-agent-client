import { describe, it, expect } from "vitest";
import {
	preparePrompt,
	promptInjectionPending,
	type PreparePromptInput,
} from "../src/services/message-sender";
import type { IVaultAccess } from "../src/services/vault-service";
import type { IMentionService } from "../src/utils/mention-parser";
import type { ChatMessage } from "../src/types/chat";

const mentionService: IMentionService = { getAllFiles: () => [] };
// No mentions or active note in these prompts, so nothing reads the vault
const vaultAccess = {} as IVaultAccess;

const WIKI =
	"When referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.";
const TABLES =
	"Always leave a blank line before Markdown tables; without it Obsidian renders them as plain text.";

const prompt = (input: Partial<PreparePromptInput>) =>
	preparePrompt(
		{
			message: "hello",
			vaultBasePath: "/vault",
			promptInjectionPending: true,
			promptInjection: [WIKI, TABLES],
			...input,
		},
		vaultAccess,
		mentionService,
	);

const texts = async (input: Partial<PreparePromptInput>) =>
	(await prompt(input)).agentContent.map((c) =>
		c.type === "text" ? c.text : c.type,
	);

describe("preparePrompt prompt injection", () => {
	it("puts the instructions in one tagged block before the message", async () => {
		const [instructions, message] = await texts({
			supportsEmbeddedContext: true,
		});
		expect(instructions).toBe(
			[
				"<obsidian_system_instruction>",
				WIKI,
				TABLES,
				"</obsidian_system_instruction>",
			].join("\n"),
		);
		expect(message).toBe("hello");
	});

	it("puts the same block before the message for text-only agents", async () => {
		const [text, ...rest] = await texts({ supportsEmbeddedContext: false });
		expect(rest).toEqual([]);
		expect(text).toMatch(
			/^<obsidian_system_instruction>\n[^]*\n<\/obsidian_system_instruction>\n\nhello$/,
		);
	});

	it("leaves the instructions out of a slash command", async () => {
		for (const supportsEmbeddedContext of [true, false]) {
			expect(
				await texts({
					message: "/review now",
					supportsEmbeddedContext,
				}),
			).toEqual(["/review now"]);
		}
	});

	it("leaves them out once sent, or when the prompts have none to carry", async () => {
		for (const input of [
			{ promptInjectionPending: false },
			{ promptInjection: [] },
			{ promptInjection: undefined },
		]) {
			expect(
				await texts({ ...input, supportsEmbeddedContext: true }),
			).toEqual(["hello"]);
		}
	});
});

const userMessage = (text: string): ChatMessage => ({
	id: text,
	role: "user",
	content: [{ type: "text", text }],
	timestamp: new Date(0),
});

const agentMessage: ChatMessage = {
	id: "agent",
	role: "assistant",
	content: [{ type: "text", text: "hi" }],
	timestamp: new Date(0),
};

describe("promptInjectionPending", () => {
	it("is pending until a prompt other than a slash command was sent", () => {
		expect(promptInjectionPending([])).toBe(true);
		expect(
			promptInjectionPending([userMessage("/skill args"), agentMessage]),
		).toBe(true);
		expect(
			promptInjectionPending([
				userMessage("/skill args"),
				agentMessage,
				userMessage("hello"),
			]),
		).toBe(false);
	});

	it("counts a prompt with an image and no text", () => {
		expect(
			promptInjectionPending([
				{
					id: "image",
					role: "user",
					content: [
						{ type: "image", data: "", mimeType: "image/png" },
					],
					timestamp: new Date(0),
				},
			]),
		).toBe(false);
	});
});
