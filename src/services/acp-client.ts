import * as acp from "@zed-industries/agent-client-protocol";
import type {
	ChatMessage,
	MessageContent,
	IAcpClient,
} from "../types/acp-types";
import { TerminalManager } from "../terminal-manager";
import { Logger } from "../utils/logger";
import type AgentClientPlugin from "../main";

// Extended RequestPermissionRequest with optional toolCall metadata
interface ExtendedRequestPermissionRequest {
	toolCall?: acp.ToolCallUpdate;
}

export class AcpClient implements IAcpClient {
	private addMessage: (message: ChatMessage) => void;
	private updateLastMessage: (content: MessageContent) => void;
	private updateMessage: (
		toolCallId: string,
		content: MessageContent,
	) => boolean;
	private currentMessageId: string | null = null;
	private pendingPermissionRequests = new Map<
		string,
		(response: acp.RequestPermissionResponse) => void
	>();
	private terminalManager: TerminalManager;
	private vaultPath: string;
	private autoAllowPermissions: boolean = false;
	private logger: Logger;

	constructor(
		addMessage: (message: ChatMessage) => void,
		updateLastMessage: (content: MessageContent) => void,
		updateMessage: (toolCallId: string, content: MessageContent) => boolean,
		vaultPath: string,
		plugin: AgentClientPlugin,
		autoAllowPermissions: boolean = false,
	) {
		this.addMessage = addMessage;
		this.updateLastMessage = updateLastMessage;
		this.updateMessage = updateMessage;
		this.vaultPath = vaultPath;
		this.autoAllowPermissions = autoAllowPermissions;
		this.logger = new Logger(plugin);
		this.terminalManager = new TerminalManager(plugin);
	}

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		this.logger.log(update);
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				if (update.content.type === "text") {
					this.updateLastMessage({
						type: "text",
						text: update.content.text,
					});
				}
				break;
			case "agent_thought_chunk":
				if (update.content.type === "text") {
					this.updateLastMessage({
						type: "agent_thought",
						text: update.content.text,
					});
				}
				break;
			case "tool_call":
				this.addMessage({
					id: crypto.randomUUID(),
					role: "assistant",
					content: [
						{
							type: "tool_call",
							toolCallId: update.toolCallId,
							title: update.title,
							status: update.status || "pending",
							kind: update.kind,
							content: update.content,
						},
					],
					timestamp: new Date(),
				});
				break;
			case "tool_call_update":
				this.logger.log(
					`[AcpClient] tool_call_update for ${update.toolCallId}, content:`,
					update.content,
				);
				this.updateMessage(update.toolCallId, {
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title,
					status: update.status || "pending",
					kind: update.kind || undefined,
					content: update.content || undefined,
				});
				break;
			case "plan":
				this.updateLastMessage({
					type: "plan",
					entries: update.entries,
				});
				break;
		}
	}

	resetCurrentMessage() {
		this.currentMessageId = null;
	}

	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		this.logger.log("Permission request received:", params);

		// Type guard: check if params has extended toolCall property
		const extendedParams =
			params as unknown as ExtendedRequestPermissionRequest;

		// If auto-allow is enabled, automatically approve the first allow option
		if (this.autoAllowPermissions) {
			const allowOption =
				params.options.find(
					(option) =>
						option.kind === "allow_once" ||
						option.kind === "allow_always" ||
						(!option.kind &&
							option.name.toLowerCase().includes("allow")),
				) || params.options[0]; // fallback to first option

			this.logger.log("Auto-allowing permission request:", allowOption);

			return Promise.resolve({
				outcome: {
					outcome: "selected",
					optionId: allowOption.optionId,
				},
			});
		}

		// Generate unique ID for this permission request
		const requestId = crypto.randomUUID();
		const toolCallId = params.toolCall.toolCallId;

		// Prepare permission request data
		const permissionRequestData = {
			requestId: requestId,
			options: params.options.map((option) => ({
				optionId: option.optionId,
				name: option.name,
				kind:
					option.kind === "reject_always"
						? "reject_once"
						: option.kind,
			})),
		};

		// Try to update existing tool_call with permission request
		const updated = this.updateMessage(toolCallId, {
			type: "tool_call",
			toolCallId: toolCallId,
			permissionRequest: permissionRequestData,
		} as MessageContent);

		// If no existing tool_call was found, create a new tool_call message with permission
		if (!updated && extendedParams.toolCall?.title) {
			const toolCallInfo = extendedParams.toolCall;
			const status = (toolCallInfo.status ||
				"pending") as acp.ToolCallStatus;
			const kind = toolCallInfo.kind as acp.ToolKind | undefined;
			const content = toolCallInfo.content as
				| acp.ToolCallContent[]
				| undefined;

			this.addMessage({
				id: crypto.randomUUID(),
				role: "assistant",
				content: [
					{
						type: "tool_call",
						toolCallId: toolCallInfo.toolCallId,
						title: toolCallInfo.title,
						status,
						kind,
						content,
						permissionRequest: permissionRequestData,
					},
				],
				timestamp: new Date(),
			});
		}

		// Return a Promise that will be resolved when user clicks a button
		return new Promise((resolve) => {
			this.pendingPermissionRequests.set(requestId, resolve);
		});
	}

	// Method to handle user's permission response
	handlePermissionResponse(requestId: string, optionId: string) {
		const resolve = this.pendingPermissionRequests.get(requestId);
		if (resolve) {
			resolve({
				outcome: {
					outcome: "selected",
					optionId: optionId,
				},
			});
			this.pendingPermissionRequests.delete(requestId);
		}
	}

	// Method to cancel all pending permission requests
	cancelPendingPermissionRequests() {
		this.logger.log(
			`Cancelling ${this.pendingPermissionRequests.size} pending permission requests`,
		);
		this.pendingPermissionRequests.forEach((resolve, requestId) => {
			resolve({
				outcome: {
					outcome: "cancelled",
				},
			});
		});
		this.pendingPermissionRequests.clear();
	}

	// Method to cancel all running operations
	cancelAllOperations() {
		this.logger.log("Cancelling all running operations...");

		// Cancel pending permission requests
		this.cancelPendingPermissionRequests();

		// Kill all running terminals
		this.terminalManager.killAllTerminals();
	}
	async readTextFile(params: acp.ReadTextFileRequest) {
		return { content: "" };
	}
	async writeTextFile(params: acp.WriteTextFileRequest) {
		return {};
	}
	async createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		this.logger.log(
			"[AcpClient] createTerminal called with params:",
			params,
		);

		// Use vault path if cwd is not provided
		const modifiedParams = {
			...params,
			cwd: params.cwd || this.vaultPath,
		};
		this.logger.log("[AcpClient] Using modified params:", modifiedParams);

		const terminalId = this.terminalManager.createTerminal(modifiedParams);
		return {
			terminalId,
		};
	}

	async terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		const result = this.terminalManager.getOutput(params.terminalId);
		if (!result) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return result;
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		return await this.terminalManager.waitForExit(params.terminalId);
	}

	async killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalResponse> {
		const success = this.terminalManager.killTerminal(params.terminalId);
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return {};
	}

	async releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		const success = this.terminalManager.releaseTerminal(params.terminalId);
		// Don't throw error if terminal not found - it may have been already cleaned up
		if (!success) {
			this.logger.log(
				`[AcpClient] releaseTerminal: Terminal ${params.terminalId} not found (may have been already cleaned up)`,
			);
		}
		return {};
	}
}
