import * as acp from "@agentclientprotocol/sdk";

import type {
	MessageContent,
	PermissionOption,
} from "../../domain/models/chat-message";
import type { SessionUpdate } from "../../domain/models/session-update";
import { AcpTypeConverter } from "./acp-type-converter";
import type { Logger } from "../../shared/logger";
import { extractBaseCommands } from "./terminal-command-policy";

export interface PendingPermissionRequest {
	resolve: (response: acp.RequestPermissionResponse) => void;
	toolCallId: string;
	options: PermissionOption[];
}

export interface PendingPermissionQueueItem {
	requestId: string;
	toolCallId: string;
	options: PermissionOption[];
}

export interface PermissionQueueState {
	pendingPermissionRequests: Map<string, PendingPermissionRequest>;
	pendingPermissionQueue: PendingPermissionQueueItem[];
}

export type TerminalPermissionMode =
	| "disabled"
	| "prompt_once"
	| "always_allow"
	| "always_deny";

function normalizePermissionKind(
	kind: unknown,
	name: string,
): PermissionOption["kind"] {
	if (
		kind === "allow_once" ||
		kind === "allow_always" ||
		kind === "reject_once" ||
		kind === "reject_always"
	) {
		return kind;
	}

	return name.toLowerCase().includes("allow") ? "allow_once" : "reject_once";
}

function isTerminalPermissionRequest(
	params: acp.RequestPermissionRequest,
): boolean {
	const toolCall = params.toolCall;
	if (!toolCall) return false;

	if (toolCall.kind === "execute") return true;

	const rawInput =
		(toolCall.rawInput as Record<string, unknown> | undefined) || {};
	if (
		typeof rawInput.command === "string" &&
		extractBaseCommands(rawInput.command).length > 0
	) {
		return true;
	}

	const title = toolCall.title?.toLowerCase() || "";
	return /\b(terminal|shell|bash|command)\b/.test(title);
}

function removeQueueItemByRequestId(
	queue: PendingPermissionQueueItem[],
	requestId: string,
): void {
	const index = queue.findIndex((entry) => entry.requestId === requestId);
	if (index >= 0) {
		queue.splice(index, 1);
	}
}

function selectAllowOptionPreferAlways(
	options: acp.PermissionOption[],
): acp.PermissionOption {
	const option =
		options.find((option) => option.kind === "allow_always") ||
		options.find((option) => option.kind === "allow_once") ||
		options.find((option) => option.name.toLowerCase().includes("allow")) ||
		options[0];

	if (!option) {
		throw new Error("Permission request has no options");
	}

	return option;
}

function selectRejectOption(
	options: acp.PermissionOption[],
): acp.PermissionOption {
	const option =
		options.find((option) => option.kind === "reject_always") ||
		options.find((option) => option.kind === "reject_once") ||
		options.find((option) => {
			const name = option.name.toLowerCase();
			return name.includes("reject") || name.includes("deny");
		}) ||
		options[0];

	if (!option) {
		throw new Error("Permission request has no options");
	}

	return option;
}

export function activateNextPermissionOperation(args: {
	state: PermissionQueueState;
	updateMessage: (toolCallId: string, content: MessageContent) => void;
}): void {
	const { state, updateMessage } = args;
	if (state.pendingPermissionQueue.length === 0) {
		return;
	}

	const next = state.pendingPermissionQueue[0];
	const pending = state.pendingPermissionRequests.get(next.requestId);
	if (!pending) {
		return;
	}

	updateMessage(next.toolCallId, {
		type: "tool_call",
		toolCallId: next.toolCallId,
		permissionRequest: {
			requestId: next.requestId,
			options: pending.options,
			isActive: true,
		},
	} as MessageContent);
}

export function handlePermissionResponseOperation(args: {
	state: PermissionQueueState;
	requestId: string;
	optionId: string;
	updateMessage: (toolCallId: string, content: MessageContent) => void;
}): void {
	const { state, requestId, optionId, updateMessage } = args;
	const request = state.pendingPermissionRequests.get(requestId);
	if (!request) {
		return;
	}

	const { resolve, toolCallId, options } = request;
	updateMessage(toolCallId, {
		type: "tool_call",
		toolCallId,
		status: "completed",
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
	state.pendingPermissionRequests.delete(requestId);
	removeQueueItemByRequestId(state.pendingPermissionQueue, requestId);
	activateNextPermissionOperation({ state, updateMessage });
}

export function cancelPendingPermissionRequestsOperation(args: {
	state: PermissionQueueState;
	logger: Logger;
	updateMessage: (toolCallId: string, content: MessageContent) => void;
}): void {
	const { state, logger, updateMessage } = args;
	logger.log(
		`[AcpAdapter] Cancelling ${state.pendingPermissionRequests.size} pending permission requests`,
	);

	state.pendingPermissionRequests.forEach(
		({ resolve, toolCallId, options }, requestId) => {
			updateMessage(toolCallId, {
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

			resolve({
				outcome: {
					outcome: "cancelled",
				},
			});
		},
	);

	state.pendingPermissionRequests.clear();
	state.pendingPermissionQueue.length = 0;
}

export async function requestPermissionOperation(args: {
	params: acp.RequestPermissionRequest;
	logger: Logger;
	terminalPermissionMode: TerminalPermissionMode;
	state: PermissionQueueState;
	updateMessage: (toolCallId: string, content: MessageContent) => void;
	sessionUpdateCallback: ((update: SessionUpdate) => void) | null;
}): Promise<acp.RequestPermissionResponse> {
	const {
		params,
		logger,
		terminalPermissionMode,
		state,
		sessionUpdateCallback,
	} = args;

	logger.log("[AcpAdapter] Permission request received:", params);
	const isTerminalRequest = isTerminalPermissionRequest(params);
	if (isTerminalRequest) {
		if (terminalPermissionMode === "disabled") {
			const rejectOption = selectRejectOption(params.options);
			logger.log(
				"[AcpAdapter] Auto-denying terminal permission request because terminal mode is disabled:",
				rejectOption,
			);
			return {
				outcome: {
					outcome: "selected",
					optionId: rejectOption.optionId,
				},
			};
		}

		if (terminalPermissionMode === "always_allow") {
			const allowOption = selectAllowOptionPreferAlways(params.options);
			logger.log(
				"[AcpAdapter] Auto-allowing terminal permission request by settings:",
				allowOption,
			);
			return {
				outcome: {
					outcome: "selected",
					optionId: allowOption.optionId,
				},
			};
		}

		if (terminalPermissionMode === "always_deny") {
			const rejectOption = selectRejectOption(params.options);
			logger.log(
				"[AcpAdapter] Auto-denying terminal permission request by settings:",
				rejectOption,
			);
			return {
				outcome: {
					outcome: "selected",
					optionId: rejectOption.optionId,
				},
			};
		}
	}

	const requestId = crypto.randomUUID();
	const toolCallId = params.toolCall?.toolCallId || crypto.randomUUID();
	const sessionId = params.sessionId;
	const normalizedOptions: PermissionOption[] = params.options.map((option) => {
		return {
			optionId: option.optionId,
			name: option.name,
			kind: normalizePermissionKind(option.kind, option.name),
		};
	});

	const isFirstRequest = state.pendingPermissionQueue.length === 0;
	const permissionRequestData = {
		requestId,
		options: normalizedOptions,
		isActive: isFirstRequest,
	};

	state.pendingPermissionQueue.push({
		requestId,
		toolCallId,
		options: normalizedOptions,
	});

	const toolCallInfo = params.toolCall;
	sessionUpdateCallback?.({
		type: "tool_call",
		sessionId,
		toolCallId,
		title: toolCallInfo?.title ?? undefined,
		status: toolCallInfo?.status || "pending",
		kind: (toolCallInfo?.kind as acp.ToolKind | undefined) ?? undefined,
		content: AcpTypeConverter.toToolCallContent(
			toolCallInfo?.content as acp.ToolCallContent[] | undefined,
		),
		rawInput: toolCallInfo?.rawInput as { [k: string]: unknown } | undefined,
		permissionRequest: permissionRequestData,
	});

	return await new Promise((resolve) => {
		state.pendingPermissionRequests.set(requestId, {
			resolve,
			toolCallId,
			options: normalizedOptions,
		});
	});
}
