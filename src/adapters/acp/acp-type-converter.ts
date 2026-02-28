import * as acp from "@agentclientprotocol/sdk";
import type { ToolCallContent } from "../../domain/models/chat-message";
import type { PromptContent } from "../../domain/models/prompt-content";
import type {
	SessionConfigOption,
	SessionConfigSelectGroup,
	SessionConfigSelectOption,
} from "../../domain/models/session-update";

/**
 * Type converter between ACP Protocol types and Domain types.
 *
 * This adapter ensures the domain layer remains independent of the ACP library.
 * When the ACP protocol changes, only this converter needs to be updated.
 */
export class AcpTypeConverter {
	/**
	 * Convert ACP ToolCallContent to domain ToolCallContent.
	 *
	 * Filters out content types that are not supported by the domain model:
	 * - Supports: "diff", "terminal"
	 * - Ignores: "content" (not implemented in UI)
	 *
	 * @param acpContent - Tool call content from ACP protocol
	 * @returns Domain model tool call content, or undefined if input is null/empty
	 */
	static toToolCallContent(
		acpContent: acp.ToolCallContent[] | undefined | null,
	): ToolCallContent[] | undefined {
		if (!acpContent) return undefined;

		const converted: ToolCallContent[] = [];

		for (const item of acpContent) {
			if (item.type === "diff") {
				converted.push({
					type: "diff",
					path: item.path,
					newText: item.newText,
					oldText: item.oldText,
				});
			} else if (item.type === "terminal") {
				converted.push({
					type: "terminal",
					terminalId: item.terminalId,
				});
			}
			// "content" type is intentionally ignored (not implemented in UI)
		}

		return converted.length > 0 ? converted : undefined;
	}

	/**
	 * Convert domain PromptContent to ACP ContentBlock.
	 *
	 * This converts our domain-layer prompt content to the ACP protocol format
	 * for sending to the agent.
	 *
	 * @param content - Domain prompt content (text, image, or resource)
	 * @returns ACP ContentBlock for use with the prompt API
	 */
	/**
	 * Convert ACP SessionConfigOption[] to domain SessionConfigOption[].
	 *
	 * @param acpOptions - Config options from ACP protocol
	 * @returns Domain model config options
	 */
	static toSessionConfigOptions(
		acpOptions: acp.SessionConfigOption[],
	): SessionConfigOption[] {
		return acpOptions.map((opt) => ({
			id: opt.id,
			name: opt.name,
			description: opt.description ?? undefined,
			category: opt.category ?? undefined,
			type: opt.type,
			currentValue: opt.currentValue,
			options: this.toSessionConfigSelectOptions(opt.options),
		}));
	}

	private static toSessionConfigSelectOptions(
		acpOptions: acp.SessionConfigSelectOptions,
	): SessionConfigSelectOption[] | SessionConfigSelectGroup[] {
		if (acpOptions.length === 0) return [];

		// Determine if grouped or flat by checking first element
		const first = acpOptions[0];
		if ("group" in first) {
			return (acpOptions as acp.SessionConfigSelectGroup[]).map((g) => ({
				group: g.group,
				name: g.name,
				options: g.options.map((o) => ({
					value: o.value,
					name: o.name,
					description: o.description ?? undefined,
				})),
			}));
		}

		return (acpOptions as acp.SessionConfigSelectOption[]).map((o) => ({
			value: o.value,
			name: o.name,
			description: o.description ?? undefined,
		}));
	}

	static toAcpContentBlock(content: PromptContent): acp.ContentBlock {
		switch (content.type) {
			case "text":
				return { type: "text", text: content.text };
			case "image":
				return {
					type: "image",
					data: content.data,
					mimeType: content.mimeType,
				};
			case "resource":
				return {
					type: "resource",
					resource: {
						uri: content.resource.uri,
						mimeType: content.resource.mimeType,
						text: content.resource.text,
					},
					annotations: content.annotations,
				};
		}
	}
}
