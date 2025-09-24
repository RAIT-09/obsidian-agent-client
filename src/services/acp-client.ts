import * as acp from "@zed-industries/agent-client-protocol";
import type {
	ChatMessage,
	MessageContent,
	IAcpClient,
} from "../types/acp-types";
import { TerminalManager } from "../terminal-manager";

export class AcpClient implements IAcpClient {
	private addMessage: (message: ChatMessage) => void;
	private updateLastMessage: (content: MessageContent) => void;
	private updateMessage: (
		toolCallId: string,
		content: MessageContent,
	) => void;
	private currentMessageId: string | null = null;
	private pendingPermissionRequests = new Map<
		string,
		(response: acp.RequestPermissionResponse) => void
	>();
	private terminalManager = new TerminalManager();
	private vaultPath: string;

	constructor(
		addMessage: (message: ChatMessage) => void,
		updateLastMessage: (content: MessageContent) => void,
		updateMessage: (toolCallId: string, content: MessageContent) => void,
		vaultPath: string,
	) {
		this.addMessage = addMessage;
		this.updateLastMessage = updateLastMessage;
		this.updateMessage = updateMessage;
		this.vaultPath = vaultPath;
	}

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		console.log(update);
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
		console.log("Permission request received:", params);

		// If tool call details are provided, add the tool call message first
		if ((params as any).toolCall && (params as any).toolCall.title) {
			const toolCallInfo = (params as any).toolCall;
			this.addMessage({
				id: crypto.randomUUID(),
				role: "assistant",
				content: [
					{
						type: "tool_call",
						toolCallId: toolCallInfo.toolCallId,
						title: toolCallInfo.title,
						status: toolCallInfo.status || "pending",
						kind: toolCallInfo.kind,
						content: toolCallInfo.content,
					},
				],
				timestamp: new Date(),
			});
		}

		// Generate unique ID for this permission request
		const requestId = crypto.randomUUID();

		// Add permission request message to chat
		this.addMessage({
			id: requestId,
			role: "assistant",
			content: [
				{
					type: "permission_request",
					toolCall: {
						toolCallId: params.toolCall.toolCallId,
					},
					options: params.options.map((option) => ({
						optionId: option.optionId,
						name: option.name,
						kind:
							option.kind === "reject_always"
								? "reject_once"
								: option.kind,
					})),
				},
			],
			timestamp: new Date(),
		});

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
		console.log(
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
		console.log("Cancelling all running operations...");

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
		console.log("[AcpClient] createTerminal called with params:", params);

		// Use vault path if cwd is not provided
		const modifiedParams = {
			...params,
			cwd: params.cwd || this.vaultPath,
		};
		console.log("[AcpClient] Using modified params:", modifiedParams);

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
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return {};
	}
}
