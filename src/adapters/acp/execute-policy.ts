import * as acp from "@agentclientprotocol/sdk";
import type { PromptContent } from "../../domain/models/prompt-content";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { Logger } from "../../shared/logger";
import { AcpTypeConverter } from "./acp-type-converter";
import {
	requestPermissionOperation,
	type PermissionQueueState,
	type TerminalPermissionMode,
} from "./permission-queue";
export { recordTerminalPermissionDecision } from "./execute-permission-decision";

type ExecuteToolCallUpdate = Extract<
	acp.SessionUpdate,
	{ sessionUpdate: "tool_call" | "tool_call_update" }
>;

interface LatestExecuteUpdate {
	sessionId: string;
	update: ExecuteToolCallUpdate;
}

export interface ExecutePolicyState {
	blockedExecuteToolCallIds: Set<string>;
	grantedExecuteToolCallIds: Set<string>;
	rejectedExecuteToolCallIds: Set<string>;
	pendingSyntheticExecutePermissionToolCallIds: Set<string>;
	latestExecuteUpdates: Map<string, LatestExecuteUpdate>;
	cancelRequestedForExecutePolicySessions: Set<string>;
}

export function resolveTerminalPermissionMode(
	mode: unknown,
): TerminalPermissionMode {
	if (
		mode === "disabled" ||
		mode === "prompt_once" ||
		mode === "always_allow" ||
		mode === "always_deny"
	) {
		return mode;
	}
	return "disabled";
}

export function withExecutionPolicyPrompt(
	content: PromptContent[],
	mode: TerminalPermissionMode,
): PromptContent[] {
	const policy =
		mode === "disabled"
			? "Client policy: terminal/command execution is disabled. Do not use execute/shell/terminal tools. Use Obsidian file-editing tools only."
			: `Client policy: terminal/command execution is enabled. Permission mode is "${mode}". ${
					mode === "prompt_once"
						? "Request ACP session/request_permission before execute/shell/terminal calls so the user can allow or deny each command."
						: mode === "always_allow"
							? "Terminal permission requests are auto-approved by client settings."
							: "Terminal permission requests are auto-denied by client settings; do not execute commands."
				}`;
	const next = [...content];
	const textIndex = next.findIndex((item) => item.type === "text");
	if (textIndex >= 0) {
		const block = next[textIndex];
		if (block.type === "text") {
			next[textIndex] = {
				type: "text",
				text: `${policy}\n\n${block.text}`,
			};
		}
		return next;
	}

	return [{ type: "text", text: policy }, ...next];
}

export function handleExecuteToolCallPolicy(args: {
	update: acp.SessionUpdate;
	sessionId: string;
	state: ExecutePolicyState;
	permissionState: PermissionQueueState;
	terminalPermissionMode: TerminalPermissionMode;
	logger: Logger;
	connection: acp.ClientSideConnection | null;
	sessionUpdateCallback: ((update: SessionUpdate) => void) | null;
	cancelSession: (sessionId: string) => Promise<void>;
}): boolean {
	const {
		update,
		sessionId,
		state,
		permissionState,
		terminalPermissionMode,
		logger,
		connection,
		sessionUpdateCallback,
		cancelSession,
	} = args;
	if (
		update.sessionUpdate !== "tool_call" &&
		update.sessionUpdate !== "tool_call_update"
	) {
		return false;
	}

	const toolCallId = update.toolCallId;
	const wasBlocked = state.blockedExecuteToolCallIds.has(toolCallId);
	const isExecute =
		update.kind === "execute" ||
		wasBlocked ||
		state.grantedExecuteToolCallIds.has(toolCallId) ||
		state.rejectedExecuteToolCallIds.has(toolCallId) ||
		state.pendingSyntheticExecutePermissionToolCallIds.has(toolCallId);
	if (!isExecute) {
		return false;
	}

	state.latestExecuteUpdates.set(toolCallId, {
		sessionId,
		update,
	});

	if (wasBlocked) {
		blockExecuteToolCallByPolicy({
			update,
			sessionId,
			reason: "already blocked by client policy",
			wasBlocked,
			state,
			logger,
			connection,
			sessionUpdateCallback,
			cancelSession,
		});
		return true;
	}

	if (terminalPermissionMode === "disabled") {
		blockExecuteToolCallByPolicy({
			update,
			sessionId,
			reason: "terminal permission mode is disabled",
			wasBlocked,
			state,
			logger,
			connection,
			sessionUpdateCallback,
			cancelSession,
		});
		return true;
	}

	if (terminalPermissionMode === "always_deny") {
		blockExecuteToolCallByPolicy({
			update,
			sessionId,
			reason: "terminal permission mode is always deny",
			wasBlocked,
			state,
			logger,
			connection,
			sessionUpdateCallback,
			cancelSession,
		});
		return true;
	}

	if (terminalPermissionMode === "prompt_once") {
		if (state.rejectedExecuteToolCallIds.has(toolCallId)) {
			blockExecuteToolCallByPolicy({
				update,
				sessionId,
				reason: "execute permission denied by user",
				wasBlocked,
				state,
				logger,
				connection,
				sessionUpdateCallback,
				cancelSession,
			});
			return true;
		}

		if (state.grantedExecuteToolCallIds.has(toolCallId)) {
			if (isToolCallStatusFinal(update.status)) {
				state.grantedExecuteToolCallIds.delete(toolCallId);
				state.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
				state.latestExecuteUpdates.delete(toolCallId);
			}
			return false;
		}

		ensureSyntheticExecutePermissionRequest({
			toolCallId,
			sessionId,
			update,
			state,
			permissionState,
			logger,
			sessionUpdateCallback,
			connection,
			cancelSession,
		});

		if (isToolCallStatusFinal(update.status)) {
			state.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
			state.latestExecuteUpdates.delete(toolCallId);
		}
		return false;
	}

	return false;
}

function blockExecuteToolCallByPolicy(args: {
	update: ExecuteToolCallUpdate;
	sessionId: string;
	reason: string;
	wasBlocked: boolean;
	state: ExecutePolicyState;
	logger: Logger;
	connection: acp.ClientSideConnection | null;
	sessionUpdateCallback: ((update: SessionUpdate) => void) | null;
	cancelSession: (sessionId: string) => Promise<void>;
}): void {
	const {
		update,
		sessionId,
		reason,
		wasBlocked,
		state,
		logger,
		connection,
		sessionUpdateCallback,
		cancelSession,
	} = args;
	const toolCallId = update.toolCallId;
	state.blockedExecuteToolCallIds.add(toolCallId);
	state.grantedExecuteToolCallIds.delete(toolCallId);
	state.rejectedExecuteToolCallIds.delete(toolCallId);
	state.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
	state.latestExecuteUpdates.delete(toolCallId);
	logger.warn("[AcpAdapter] Blocking execute tool call by policy:", {
		sessionId,
		toolCallId,
		reason,
		title: update.title,
		rawInput: update.rawInput,
	});

	sessionUpdateCallback?.({
		type: update.sessionUpdate,
		sessionId,
		toolCallId,
		title: update.title
			? `${update.title} (blocked by client policy: ${reason})`
			: `Command blocked by client policy: ${reason}`,
		status: "failed",
		kind: "execute",
		content: AcpTypeConverter.toToolCallContent(update.content),
		locations: update.locations ?? undefined,
		rawInput: update.rawInput as { [k: string]: unknown } | undefined,
	});

	if (
		!wasBlocked &&
		connection &&
		!state.cancelRequestedForExecutePolicySessions.has(sessionId)
	) {
		state.cancelRequestedForExecutePolicySessions.add(sessionId);
		void cancelSession(sessionId)
			.catch((error: unknown) => {
				logger.warn(
					`[AcpAdapter] Failed to cancel session after blocked execute tool call (${sessionId}):`,
					error,
				);
			})
			.finally(() => {
				state.cancelRequestedForExecutePolicySessions.delete(sessionId);
			});
	}
}

function ensureSyntheticExecutePermissionRequest(args: {
	toolCallId: string;
	sessionId: string;
	update: ExecuteToolCallUpdate;
	state: ExecutePolicyState;
	permissionState: PermissionQueueState;
	logger: Logger;
	sessionUpdateCallback: ((update: SessionUpdate) => void) | null;
	connection: acp.ClientSideConnection | null;
	cancelSession: (sessionId: string) => Promise<void>;
}): void {
	const {
		toolCallId,
		sessionId,
		update,
		state,
		permissionState,
		logger,
		sessionUpdateCallback,
		connection,
		cancelSession,
	} = args;
	if (state.pendingSyntheticExecutePermissionToolCallIds.has(toolCallId)) {
		return;
	}
	state.pendingSyntheticExecutePermissionToolCallIds.add(toolCallId);
	void requestPermissionOperation({
		params: {
			sessionId,
			toolCall: {
				toolCallId,
				title: update.title,
				status: update.status,
				kind: "execute",
				content: update.content,
				locations: update.locations,
				rawInput: update.rawInput,
			},
			options: [
				{
					optionId: `synthetic:${toolCallId}:allow_once`,
					name: "Allow",
					kind: "allow_once",
				},
				{
					optionId: `synthetic:${toolCallId}:reject_once`,
					name: "Deny",
					kind: "reject_once",
				},
			],
		},
		logger,
		terminalPermissionMode: "prompt_once",
		state: permissionState,
		sessionUpdateCallback,
	})
		.then((response) => {
			handleSyntheticExecutePermissionOutcome({
				toolCallId,
				response,
				state,
				sessionId,
				logger,
				connection,
				cancelSession,
				sessionUpdateCallback,
			});
		})
		.catch((error: unknown) => {
			logger.warn("[AcpAdapter] Synthetic execute permission request failed:", {
				toolCallId,
				error,
			});
			const latest = state.latestExecuteUpdates.get(toolCallId);
			if (latest) {
				blockExecuteToolCallByPolicy({
					update: latest.update,
					sessionId: latest.sessionId,
					reason: "failed to complete execute permission prompt",
					wasBlocked: false,
					state,
					logger,
					connection,
					sessionUpdateCallback,
					cancelSession,
				});
			}
		})
		.finally(() => {
			state.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
		});
}

function handleSyntheticExecutePermissionOutcome(args: {
	toolCallId: string;
	response: acp.RequestPermissionResponse;
	state: ExecutePolicyState;
	sessionId: string;
	logger: Logger;
	connection: acp.ClientSideConnection | null;
	cancelSession: (sessionId: string) => Promise<void>;
	sessionUpdateCallback: ((update: SessionUpdate) => void) | null;
}): void {
	const {
		toolCallId,
		response,
		state,
		logger,
		connection,
		cancelSession,
		sessionUpdateCallback,
	} = args;
	const selectedOptionId =
		response.outcome.outcome === "selected" &&
		"optionId" in response.outcome
			? response.outcome.optionId
			: null;
	const isAllowed = selectedOptionId === `synthetic:${toolCallId}:allow_once`;
	if (isAllowed) {
		state.grantedExecuteToolCallIds.add(toolCallId);
		const latest = state.latestExecuteUpdates.get(toolCallId);
		if (latest && isToolCallStatusFinal(latest.update.status)) {
			state.grantedExecuteToolCallIds.delete(toolCallId);
			state.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
			state.latestExecuteUpdates.delete(toolCallId);
		}
		return;
	}

	state.rejectedExecuteToolCallIds.add(toolCallId);
	const latest = state.latestExecuteUpdates.get(toolCallId);
	if (latest) {
		blockExecuteToolCallByPolicy({
			update: latest.update,
			sessionId: latest.sessionId,
			reason: "execute permission denied by user",
			wasBlocked: false,
			state,
			logger,
			connection,
			sessionUpdateCallback,
			cancelSession,
		});
	}
}

function isToolCallStatusFinal(status: string | null | undefined): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}
