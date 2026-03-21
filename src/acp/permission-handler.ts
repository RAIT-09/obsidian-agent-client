import * as acp from "@agentclientprotocol/sdk";
import type {
	MessageContent,
	PermissionOption,
} from "../types/chat";
import type { SessionUpdate } from "../types/session";
import { AcpTypeConverter } from "./type-converter";
import { getLogger, Logger } from "../utils/logger";

/**
 * Callbacks that PermissionManager uses to communicate with the outside world.
 *
 * These are injected by AcpAdapter and wrap the dynamically-set callbacks
 * (sessionUpdateCallback, updateMessage) so that PermissionManager doesn't
 * need to know about AcpAdapter's lifecycle.
 */
interface PermissionManagerCallbacks {
	/** Emit a session update event (used to notify UI of new permission requests) */
	onSessionUpdate: (update: SessionUpdate) => void;
	/** Update an existing tool call message (used to reflect permission state changes) */
	onUpdateMessage: (toolCallId: string, content: MessageContent) => void;
}

/**
 * Manages permission request lifecycle for ACP agent operations.
 *
 * Handles:
 * - Receiving permission requests from the agent (via ACP protocol)
 * - Auto-approval based on user settings
 * - Queuing requests (only one active at a time in UI)
 * - Resolving/cancelling pending permission Promises
 * - Notifying UI of permission state changes
 *
 * This class was extracted from AcpAdapter to separate the permission
 * state machine from the main protocol adapter.
 */
export class PermissionManager {
	private logger: Logger;
	private callbacks: PermissionManagerCallbacks;
	private autoAllow: boolean;

	/** Map of pending permission requests awaiting user response */
	private pendingRequests = new Map<
		string,
		{
			resolve: (response: acp.RequestPermissionResponse) => void;
			toolCallId: string;
			options: PermissionOption[];
		}
	>();

	/** Queue of permission requests (first entry is the active one in UI) */
	private requestQueue: Array<{
		requestId: string;
		toolCallId: string;
		options: PermissionOption[];
	}> = [];

	constructor(callbacks: PermissionManagerCallbacks, autoAllow: boolean) {
		this.logger = getLogger();
		this.callbacks = callbacks;
		this.autoAllow = autoAllow;
	}

	/**
	 * Update the auto-allow setting.
	 * Called by AcpAdapter during initialize() when settings are read.
	 */
	setAutoAllow(autoAllow: boolean): void {
		this.autoAllow = autoAllow;
	}

	/**
	 * Handle a permission request from the agent (ACP protocol).
	 *
	 * This is the core method called by AcpAdapter.requestPermission().
	 * It either auto-approves or creates a pending request with a Promise
	 * that resolves when the user responds via the UI.
	 */
	async request(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		this.logger.log(
			"[PermissionManager] Permission request received:",
			params,
		);

		// If auto-allow is enabled, automatically approve the first allow option
		if (this.autoAllow) {
			const allowOption =
				params.options.find(
					(option) =>
						option.kind === "allow_once" ||
						option.kind === "allow_always" ||
						(!option.kind &&
							option.name.toLowerCase().includes("allow")),
				) || params.options[0]; // fallback to first option

			this.logger.log(
				"[PermissionManager] Auto-allowing permission request:",
				allowOption,
			);

			return Promise.resolve({
				outcome: {
					outcome: "selected",
					optionId: allowOption.optionId,
				},
			});
		}

		// Generate unique ID for this permission request
		const requestId = crypto.randomUUID();
		const toolCallId = params.toolCall?.toolCallId || crypto.randomUUID();
		const sessionId = params.sessionId;

		const normalizedOptions: PermissionOption[] = params.options.map(
			(option) => {
				const normalizedKind =
					option.kind === "reject_always"
						? "reject_once"
						: option.kind;
				const kind: PermissionOption["kind"] = normalizedKind
					? normalizedKind
					: option.name.toLowerCase().includes("allow")
						? "allow_once"
						: "reject_once";

				return {
					optionId: option.optionId,
					name: option.name,
					kind,
				};
			},
		);

		const isFirstRequest = this.requestQueue.length === 0;

		// Prepare permission request data
		const permissionRequestData = {
			requestId: requestId,
			options: normalizedOptions,
			isActive: isFirstRequest,
		};

		this.requestQueue.push({
			requestId,
			toolCallId,
			options: normalizedOptions,
		});

		// Emit tool_call with permission request via session update callback
		const toolCallInfo = params.toolCall;
		this.callbacks.onSessionUpdate({
			type: "tool_call",
			sessionId,
			toolCallId: toolCallId,
			title: toolCallInfo?.title ?? undefined,
			status: toolCallInfo?.status || "pending",
			kind:
				(toolCallInfo?.kind as acp.ToolKind | undefined) ?? undefined,
			content: AcpTypeConverter.toToolCallContent(
				toolCallInfo?.content as acp.ToolCallContent[] | undefined,
			),
			rawInput: toolCallInfo?.rawInput as
				| { [k: string]: unknown }
				| undefined,
			permissionRequest: permissionRequestData,
		});

		// Return a Promise that will be resolved when user clicks a button
		return new Promise((resolve) => {
			this.pendingRequests.set(requestId, {
				resolve,
				toolCallId,
				options: normalizedOptions,
			});
		});
	}

	/**
	 * Handle user's response to a permission request.
	 *
	 * Resolves the pending Promise, updates UI, and activates the next
	 * queued request if any.
	 */
	respond(requestId: string, optionId: string): void {
		const request = this.pendingRequests.get(requestId);
		if (!request) {
			return;
		}

		const { resolve, toolCallId, options } = request;

		// Reflect the selection in the UI immediately
		this.callbacks.onUpdateMessage(toolCallId, {
			type: "tool_call",
			toolCallId,
			permissionRequest: {
				requestId,
				options,
				selectedOptionId: optionId,
				isActive: false,
			},
		} as MessageContent);

		resolve({
			outcome: {
				outcome: "selected",
				optionId,
			},
		});
		this.pendingRequests.delete(requestId);
		this.requestQueue = this.requestQueue.filter(
			(entry) => entry.requestId !== requestId,
		);
		this.activateNext();
	}

	/**
	 * Cancel all pending permission requests.
	 *
	 * Called during cancel() and disconnect() to clean up.
	 * Updates UI to show cancelled state and resolves all Promises
	 * with cancelled outcome.
	 */
	cancelAll(): void {
		this.logger.log(
			`[PermissionManager] Cancelling ${this.pendingRequests.size} pending permission requests`,
		);
		this.pendingRequests.forEach(
			({ resolve, toolCallId, options }, requestId) => {
				// Update UI to show cancelled state
				this.callbacks.onUpdateMessage(toolCallId, {
					type: "tool_call",
					toolCallId,
					status: "completed",
					permissionRequest: {
						requestId,
						options,
						isCancelled: true,
						isActive: false,
					},
				} as MessageContent);

				// Resolve the promise with cancelled outcome
				resolve({
					outcome: {
						outcome: "cancelled",
					},
				});
			},
		);
		this.pendingRequests.clear();
		this.requestQueue = [];
	}

	/**
	 * Activate the next queued permission request in UI.
	 */
	private activateNext(): void {
		if (this.requestQueue.length === 0) {
			return;
		}

		const next = this.requestQueue[0];
		const pending = this.pendingRequests.get(next.requestId);
		if (!pending) {
			return;
		}

		this.callbacks.onUpdateMessage(next.toolCallId, {
			type: "tool_call",
			toolCallId: next.toolCallId,
			permissionRequest: {
				requestId: next.requestId,
				options: pending.options,
				isActive: true,
			},
		} as MessageContent);
	}
}
