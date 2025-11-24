import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";
import type { ChatMessage, MessageContent } from "../types";
import { Logger } from "./logger";
import { TFile } from "obsidian";

export class ChatExporter {
	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = new Logger(plugin);
	}

	async exportToMarkdown(
		messages: ChatMessage[],
		agentLabel: string,
		agentId: string,
		sessionId: string,
		sessionCreatedAt: Date,
		openFile = true,
	): Promise<string> {
		const settings = this.plugin.settings.exportSettings;
		const fileName = this.generateFileName(sessionCreatedAt);
		const folderPath = settings.defaultFolder || "Agent Client";

		// Create folder if it doesn't exist
		await this.ensureFolderExists(folderPath);

		const filePath = `${folderPath}/${fileName}.md`;

		try {
			const frontmatter = this.generateFrontmatter(
				agentLabel,
				agentId,
				sessionId,
				sessionCreatedAt,
			);
			const chatContent = this.convertMessagesToMarkdown(
				messages,
				agentLabel,
				sessionId,
				sessionCreatedAt,
			);
			const fullContent = `${frontmatter}\n\n${chatContent}`;

			// Check if file already exists
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(filePath);
			let file: TFile;

			if (existingFile instanceof TFile) {
				// File exists, update it
				await this.plugin.app.vault.modify(existingFile, fullContent);
				file = existingFile;
			} else {
				// File doesn't exist, create it
				file = await this.plugin.app.vault.create(
					filePath,
					fullContent,
				);
			}

			// Open the exported file if requested
			if (openFile) {
				const leaf = this.plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file);
			}

			this.logger.log(`Chat exported to: ${filePath}`);
			return filePath;
		} catch (error) {
			this.logger.error("Export error:", error);
			throw error;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	private generateFileName(timestamp: Date): string {
		const settings = this.plugin.settings.exportSettings;
		const template =
			settings.filenameTemplate || "agent_client_{date}_{time}";

		// Format date in local timezone: 20251115
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, "0");
		const day = String(timestamp.getDate()).padStart(2, "0");
		const dateStr = `${year}${month}${day}`;

		// Format time in local timezone: 012345
		const hours = String(timestamp.getHours()).padStart(2, "0");
		const minutes = String(timestamp.getMinutes()).padStart(2, "0");
		const seconds = String(timestamp.getSeconds()).padStart(2, "0");
		const timeStr = `${hours}${minutes}${seconds}`;

		return template.replace("{date}", dateStr).replace("{time}", timeStr);
	}

	private generateFrontmatter(
		agentLabel: string,
		agentId: string,
		sessionId: string,
		timestamp: Date,
	): string {
		// Format timestamp in local timezone: YYYY-MM-DDTHH:mm:ss
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, "0");
		const day = String(timestamp.getDate()).padStart(2, "0");
		const hours = String(timestamp.getHours()).padStart(2, "0");
		const minutes = String(timestamp.getMinutes()).padStart(2, "0");
		const seconds = String(timestamp.getSeconds()).padStart(2, "0");
		const localTimestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;

		return `---
created: ${localTimestamp}
agentDisplayName: ${agentLabel}
agentId: ${agentId}
session_id: ${sessionId}
tags: [agent-client]
---`;
	}

	private convertMessagesToMarkdown(
		messages: ChatMessage[],
		agentLabel: string,
		sessionId: string,
		timestamp: Date,
	): string {
		let markdown = `# ${agentLabel}\n\n`;

		for (const message of messages) {
			const timeStr = message.timestamp.toLocaleTimeString();
			const role = message.role === "user" ? "User" : "Assistant";

			markdown += `## ${timeStr} - ${role}\n\n`;

			for (const content of message.content) {
				markdown += this.convertContentToMarkdown(content);
			}

			markdown += "\n---\n\n";
		}

		return markdown;
	}

	private convertContentToMarkdown(content: MessageContent): string {
		switch (content.type) {
			case "text":
				return content.text + "\n\n";

			case "text_with_context": {
				// User messages with auto-mention context
				// Add auto-mention in @[[note]] format at the beginning
				let exportText = "";
				if (content.autoMentionContext) {
					const { noteName, selection } = content.autoMentionContext;
					if (selection) {
						exportText += `@[[${noteName}]]:${selection.fromLine}-${selection.toLine}\n`;
					} else {
						exportText += `@[[${noteName}]]\n`;
					}
				}
				// Add the message text (which may contain additional @[[note]] mentions)
				exportText += content.text + "\n\n";
				return exportText;
			}

			case "agent_thought":
				return `> [!info]- Thinking\n> ${content.text.split("\n").join("\n> ")}\n\n`;

			case "tool_call":
				return this.convertToolCallToMarkdown(content);

			case "terminal":
				return `### 🖥️ Terminal: ${content.terminalId.slice(0, 8)}\n\n`;

			case "plan":
				return this.convertPlanToMarkdown(content);

			case "permission_request":
				return this.convertPermissionRequestToMarkdown(content);

			case "image":
				if (content.uri) {
					return `![Image](${content.uri})\n\n`;
				}
				// Base64 image
				return `![Image](data:${content.mimeType};base64,${content.data})\n\n`;

			default:
				return "";
		}
	}

	private convertToolCallToMarkdown(
		content: Extract<MessageContent, { type: "tool_call" }>,
	): string {
		let md = `### 🔧 ${content.title || "Tool"}\n\n`;
		md += `**Status**: ${content.status}\n\n`;

		// Only export diffs
		if (content.content && content.content.length > 0) {
			for (const item of content.content) {
				if (item.type === "diff") {
					md += this.convertDiffToMarkdown(item);
				}
			}
		}

		return md;
	}

	private convertDiffToMarkdown(diff: {
		type: "diff";
		path: string;
		oldText?: string | null;
		newText: string;
	}): string {
		let md = `**File**: \`${diff.path}\`\n\n`;

		// Check if this is a new file
		if (
			diff.oldText === null ||
			diff.oldText === undefined ||
			diff.oldText === ""
		) {
			md += "```diff\n";
			diff.newText.split("\n").forEach((line) => {
				md += `+ ${line}\n`;
			});
			md += "```\n\n";
			return md;
		}

		// Generate proper diff format
		const oldLines = diff.oldText.split("\n");
		const newLines = diff.newText.split("\n");

		md += "```diff\n";

		// Show removed lines
		oldLines.forEach((line) => {
			md += `- ${line}\n`;
		});

		// Show added lines
		newLines.forEach((line) => {
			md += `+ ${line}\n`;
		});

		md += "```\n\n";
		return md;
	}

	private convertPlanToMarkdown(
		content: Extract<MessageContent, { type: "plan" }>,
	): string {
		let md = `> [!plan] Plan\n`;
		for (const entry of content.entries) {
			const status =
				entry.status === "completed"
					? "✅"
					: entry.status === "in_progress"
						? "🔄"
						: "⏳";
			md += `> ${status} ${entry.content}\n`;
		}
		md += `\n`;
		return md;
	}

	private convertPermissionRequestToMarkdown(
		content: Extract<MessageContent, { type: "permission_request" }>,
	): string {
		const status = content.isCancelled ? "Cancelled" : "Requested";
		return `### ⚠️ Permission: ${content.toolCall.title || "Unknown"} (${status})\n\n`;
	}
}
