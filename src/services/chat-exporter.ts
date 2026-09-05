import type AgentClientPlugin from "../plugin";
import type {
	ChatMessage,
	MessageContent,
	ToolResultContentBlock,
} from "../types/chat";
import { getLogger, Logger } from "../utils/logger";
import { TFile } from "obsidian";

/**
 * Wrap text in a fenced code block whose fence is longer than any backtick
 * run inside, so output that itself contains ``` cannot break out.
 */
export function fencedCodeBlock(text: string): string {
	const ticks = text.match(/`+/g);
	const run = ticks ? Math.max(...ticks.map((t) => t.length)) : 0;
	const fence = "`".repeat(Math.max(3, run + 1));
	return `${fence}\n${text}\n${fence}\n\n`;
}

/**
 * Convert the pure (no vault I/O) tool-result blocks to markdown.
 * Image and audio need the attachment pipeline and are handled by the
 * exporter class; this returns null for them.
 */
export function convertToolResultBlockToMarkdown(
	block: ToolResultContentBlock,
): string | null {
	switch (block.type) {
		case "text":
			return fencedCodeBlock(block.text);
		case "resource_link": {
			const label = block.title || block.name;
			const desc = block.description ? ` — ${block.description}` : "";
			return `[${label}](${block.uri})${desc}\n\n`;
		}
		case "resource":
			return "text" in block.resource
				? `**Resource**: \`${block.resource.uri}\`\n\n` +
						fencedCodeBlock(block.resource.text)
				: `**Resource**: \`${block.resource.uri}\` (binary · ${block.resource.mimeType || "unknown type"})\n\n`;
		default:
			return null;
	}
}

/** Convert the raw-output fallback (shown when a tool returned no content). */
export function convertRawOutputToMarkdown(rawOutput: unknown): string {
	const text =
		typeof rawOutput === "string"
			? rawOutput
			: JSON.stringify(rawOutput, null, 2);
	return `**Raw output**:\n\n${fencedCodeBlock(text)}`;
}

/**
 * Context for content conversion, tracking state across messages.
 */
interface ConvertContext {
	/** Path of the export markdown file */
	exportFilePath: string;
	/** Counter for image numbering */
	imageIndex: number;
	/** Whether to include images in export */
	includeImages: boolean;
	/** Where to save images */
	imageLocation: "obsidian" | "custom" | "base64";
	/** Custom folder for images */
	imageCustomFolder: string;
	/** Counter for audio numbering (separate so image numbers stay stable) */
	audioIndex: number;
	/** Whether to include audio in export */
	includeAudios: boolean;
	/** Where to save audio (no base64 option) */
	audioLocation: "obsidian" | "custom";
	/** Custom folder for audio */
	audioCustomFolder: string;
}

export class ChatExporter {
	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
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

		// Use first message timestamp if available, fallback to session creation time
		const effectiveTimestamp =
			messages.length > 0 ? messages[0].timestamp : sessionCreatedAt;

		const baseFileName = this.generateFileName(effectiveTimestamp);
		const folderPath = settings.defaultFolder || "Agent Client";

		// Create folder if it doesn't exist
		await this.ensureFolderExists(folderPath);

		// Resolve file path considering session ID conflicts
		const filePath = this.resolveExportFilePath(
			folderPath,
			baseFileName,
			sessionId,
		);

		try {
			const frontmatter = this.generateFrontmatter(
				agentLabel,
				agentId,
				sessionId,
				effectiveTimestamp,
			);
			const chatContent = await this.convertMessagesToMarkdown(
				messages,
				agentLabel,
				filePath,
			);
			const fullContent = `${frontmatter}\n\n${chatContent}`;

			// Check if file already exists (path is already resolved for our session)
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(filePath);
			let file: TFile;

			if (existingFile instanceof TFile) {
				// File exists (same session), update it
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

	/**
	 * Extract session_id from file's frontmatter cache.
	 *
	 * Uses Obsidian's metadataCache for efficient access (no disk I/O).
	 * This is the same pattern used in vault.adapter.ts and mention-service.ts.
	 *
	 * @param file - TFile to extract session_id from
	 * @returns session_id string if found, null otherwise
	 */
	private getSessionIdFromFile(file: TFile): string | null {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const sessionId = cache?.frontmatter?.session_id as string | undefined;
		return sessionId ?? null;
	}

	/**
	 * Resolve export file path, handling session ID conflicts.
	 *
	 * Resolution logic:
	 * 1. If no file exists at base path → use base path
	 * 2. If file exists with same sessionId → use base path (overwrite)
	 * 3. If file exists with different sessionId → try suffixed paths (_2, _3, ...)
	 *    - If suffixed file has same sessionId → use that path (overwrite)
	 *    - If suffixed file has different sessionId → continue searching
	 *    - If no suffixed file exists → use that path (create new)
	 *
	 * @param folderPath - Export folder path
	 * @param baseFileName - Base file name without extension
	 * @param sessionId - Current session's ID
	 * @returns Resolved file path
	 */
	private resolveExportFilePath(
		folderPath: string,
		baseFileName: string,
		sessionId: string,
	): string {
		const basePath = `${folderPath}/${baseFileName}.md`;

		// Check if base file exists
		const existingFile =
			this.plugin.app.vault.getAbstractFileByPath(basePath);

		if (!(existingFile instanceof TFile)) {
			// No existing file, use base path
			return basePath;
		}

		// File exists - check sessionId in frontmatter
		const existingSessionId = this.getSessionIdFromFile(existingFile);

		if (existingSessionId === sessionId) {
			// Same session, overwrite
			return basePath;
		}

		// Different session (or no sessionId in frontmatter) - find available suffix
		// Start from 2 to follow common convention (file, file_2, file_3, ...)
		for (let suffix = 2; suffix <= 100; suffix++) {
			const suffixedPath = `${folderPath}/${baseFileName}_${suffix}.md`;
			const suffixedFile =
				this.plugin.app.vault.getAbstractFileByPath(suffixedPath);

			if (!(suffixedFile instanceof TFile)) {
				// No file at this path, use it
				return suffixedPath;
			}

			// Check if this file belongs to our session
			const suffixedSessionId = this.getSessionIdFromFile(suffixedFile);
			if (suffixedSessionId === sessionId) {
				// Found our session's file
				return suffixedPath;
			}

			// Different session, continue searching
		}

		// Safety fallback: exceeded limit, use the last checked path
		// This should rarely happen (100+ exports with same timestamp)
		this.logger.warn(
			`Too many export files with same base name: ${baseFileName}`,
		);
		return `${folderPath}/${baseFileName}_101.md`;
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
		const settings = this.plugin.settings.exportSettings;

		// Format timestamp in local timezone: YYYY-MM-DDTHH:mm:ss
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, "0");
		const day = String(timestamp.getDate()).padStart(2, "0");
		const hours = String(timestamp.getHours()).padStart(2, "0");
		const minutes = String(timestamp.getMinutes()).padStart(2, "0");
		const seconds = String(timestamp.getSeconds()).padStart(2, "0");
		const localTimestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;

		// Build tags line only if tag is specified
		const tagsLine = settings.frontmatterTag.trim()
			? `\ntags: [${settings.frontmatterTag.trim()}]`
			: "";

		return `---
created: ${localTimestamp}
agentDisplayName: ${agentLabel}
agentId: ${agentId}
session_id: ${sessionId}${tagsLine}
---`;
	}

	private async convertMessagesToMarkdown(
		messages: ChatMessage[],
		agentLabel: string,
		exportFilePath: string,
	): Promise<string> {
		const settings = this.plugin.settings.exportSettings;
		const context: ConvertContext = {
			exportFilePath,
			imageIndex: 0,
			includeImages: settings.includeImages,
			imageLocation: settings.imageLocation,
			imageCustomFolder: settings.imageCustomFolder,
			audioIndex: 0,
			includeAudios: settings.includeAudios,
			audioLocation: settings.audioLocation,
			audioCustomFolder: settings.audioCustomFolder,
		};

		let markdown = `# ${agentLabel}\n\n`;

		for (const message of messages) {
			const timeStr = message.timestamp.toLocaleTimeString();
			const role = message.role === "user" ? "User" : "Assistant";

			markdown += `## ${timeStr} - ${role}\n\n`;

			for (const content of message.content) {
				markdown += await this.convertContentToMarkdown(
					content,
					context,
				);
			}

			markdown += "\n---\n\n";
		}

		return markdown;
	}

	private async convertContentToMarkdown(
		content: MessageContent,
		context: ConvertContext,
	): Promise<string> {
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
				return this.convertToolCallToMarkdown(content, context);

			case "terminal":
				return `### 🖥️ Terminal: ${content.terminalId.slice(0, 8)}\n\n`;

			case "plan":
				return this.convertPlanToMarkdown(content);

			case "resource_link":
				return `[${content.name}](${content.uri})\n\n`;

			case "image":
				return this.convertImageToMarkdown(content, context);

			default:
				return "";
		}
	}

	/**
	 * Convert a base64/uri image to markdown following the export image
	 * policy: external uri as-is, base64 mode as a data URI, otherwise an
	 * attachment file with a data-URI fallback when saving fails.
	 */
	private async convertImageToMarkdown(
		image: { data: string; mimeType: string; uri?: string },
		context: ConvertContext,
	): Promise<string> {
		// Skip if images are not included
		if (!context.includeImages) {
			return "";
		}

		// External URI - use as-is
		if (image.uri) {
			return `![Image](${image.uri})\n\n`;
		}

		// Base64 embedding mode
		if (context.imageLocation === "base64") {
			return `![Image](data:${image.mimeType};base64,${image.data})\n\n`;
		}

		// Save as attachment (obsidian or custom)
		try {
			context.imageIndex++;
			const attachmentPath = await this.saveMediaAsAttachment(
				image.data,
				image.mimeType,
				context.exportFilePath,
				context.imageIndex,
				context.imageLocation,
				context.imageCustomFolder,
				"png",
			);
			// Use filename only (Obsidian resolves it)
			const fileName = attachmentPath.split("/").pop();
			return `![[${fileName}]]\n\n`;
		} catch (error) {
			this.logger.error(`Failed to save image as attachment: ${error}`);
			// Fallback to base64 embedding
			return `![Image](data:${image.mimeType};base64,${image.data})\n\n`;
		}
	}

	private async convertToolCallToMarkdown(
		content: Extract<MessageContent, { type: "tool_call" }>,
		context: ConvertContext,
	): Promise<string> {
		let md = `### 🔧 ${content.title || "Tool"}\n\n`;

		// Add locations if present
		if (content.locations && content.locations.length > 0) {
			const locationStrs = content.locations.map((loc) =>
				loc.line != null
					? `\`${loc.path}:${loc.line}\``
					: `\`${loc.path}\``,
			);
			md += `**Locations**: ${locationStrs.join(", ")}\n\n`;
		}

		md += `**Status**: ${content.status}\n\n`;

		// Terminals are ids of live processes; there is nothing to export.
		if (content.content && content.content.length > 0) {
			for (const item of content.content) {
				if (item.type === "diff") {
					md += this.convertDiffToMarkdown(item);
				} else if (item.type === "content") {
					if (item.content.type === "image") {
						md += await this.convertImageToMarkdown(
							item.content,
							context,
						);
					} else if (item.content.type === "audio") {
						md += await this.convertAudioToMarkdown(
							item.content,
							context,
						);
					} else {
						md +=
							convertToolResultBlockToMarkdown(item.content) ??
							"";
					}
				}
			}
		}

		if (
			content.rawOutput !== undefined &&
			(!content.content || content.content.length === 0)
		) {
			md += convertRawOutputToMarkdown(content.rawOutput);
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

	/**
	 * Save tool-result audio as an attachment and embed it. There is no
	 * base64 mode for audio (a data URI cannot play from markdown); when
	 * saving fails the export carries a placeholder line instead.
	 */
	private async convertAudioToMarkdown(
		audio: { data: string; mimeType: string },
		context: ConvertContext,
	): Promise<string> {
		if (!context.includeAudios) return "";
		try {
			context.audioIndex++;
			const attachmentPath = await this.saveMediaAsAttachment(
				audio.data,
				audio.mimeType,
				context.exportFilePath,
				context.audioIndex,
				context.audioLocation,
				context.audioCustomFolder,
				"mp3",
			);
			const fileName = attachmentPath.split("/").pop();
			return `![[${fileName}]]\n\n`;
		} catch (error) {
			this.logger.error(`Failed to save audio as attachment: ${error}`);
			return `> Audio (${audio.mimeType}) could not be saved.\n\n`;
		}
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

	/**
	 * Save a base64-encoded media file (image or audio) as an attachment.
	 * Uses Obsidian's attachment settings to determine the save location.
	 * Skips saving if the file already exists.
	 */
	private async saveMediaAsAttachment(
		base64Data: string,
		mimeType: string,
		exportFilePath: string,
		mediaIndex: number,
		location: "obsidian" | "custom",
		customFolder: string,
		fallbackExt: string,
	): Promise<string> {
		const ext = this.getExtensionFromMimeType(mimeType, fallbackExt);

		// Generate media filename based on export filename
		const exportFileName = exportFilePath.replace(/\.md$/, "");
		const baseName = exportFileName.split("/").pop() || "media";
		const imageFileName = `${baseName}_${String(mediaIndex).padStart(3, "0")}.${ext}`;

		let attachmentPath: string;

		if (location === "custom") {
			// Save to custom folder
			const folder = customFolder || "Agent Client";
			await this.ensureFolderExists(folder);
			attachmentPath = `${folder}/${imageFileName}`;

			// Check if file already exists
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(attachmentPath);
			if (existingFile instanceof TFile) {
				this.logger.log(
					`Image already exists, skipping: ${attachmentPath}`,
				);
				return attachmentPath;
			}
		} else {
			// Use Obsidian's attachment folder settings
			attachmentPath =
				await this.plugin.app.fileManager.getAvailablePathForAttachment(
					imageFileName,
					exportFilePath,
				);

			// Check if file already exists by comparing paths
			// getAvailablePathForAttachment returns the original name if it doesn't exist,
			// or adds a suffix (e.g., "image_001 1.png") if it does exist.
			if (!attachmentPath.endsWith(imageFileName)) {
				// File exists - return the original path (without suffix)
				const originalPath = attachmentPath.replace(
					/ \d+(\.[^.]+)$/,
					"$1",
				);
				this.logger.log(
					`Image already exists, skipping: ${originalPath}`,
				);
				return originalPath;
			}
		}

		// Save the image
		const binaryData = this.base64ToArrayBuffer(base64Data);
		await this.plugin.app.vault.createBinary(attachmentPath, binaryData);
		this.logger.log(`Image saved as attachment: ${attachmentPath}`);

		return attachmentPath;
	}

	/**
	 * Get file extension from MIME type.
	 */
	private getExtensionFromMimeType(
		mimeType: string,
		fallback: string,
	): string {
		const map: Record<string, string> = {
			"image/png": "png",
			"image/jpeg": "jpg",
			"image/gif": "gif",
			"image/webp": "webp",
			"audio/mpeg": "mp3",
			"audio/mp3": "mp3",
			"audio/wav": "wav",
			"audio/x-wav": "wav",
			"audio/ogg": "ogg",
			"audio/mp4": "m4a",
			"audio/m4a": "m4a",
			"audio/flac": "flac",
			"audio/webm": "webm",
		};
		return map[mimeType] || fallback;
	}

	/**
	 * Convert base64 string to ArrayBuffer.
	 */
	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}
}
