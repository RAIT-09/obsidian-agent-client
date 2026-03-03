import * as acp from "@agentclientprotocol/sdk";
import type { ExecutePolicyState } from "./execute-policy";

export function recordTerminalPermissionDecision(args: {
	params: acp.RequestPermissionRequest;
	response: acp.RequestPermissionResponse;
	state: ExecutePolicyState;
}): void {
	const { params, response, state } = args;
	if (!isTerminalPermissionRequest(params)) {
		return;
	}

	if (response.outcome.outcome !== "selected") {
		return;
	}

	const toolCallId = params.toolCall?.toolCallId;
	if (!toolCallId) {
		return;
	}

	const selectedOptionId =
		"optionId" in response.outcome ? response.outcome.optionId : null;
	if (!selectedOptionId) {
		return;
	}

	const selectedOption = params.options.find(
		(option) => option.optionId === selectedOptionId,
	);
	if (!selectedOption) {
		return;
	}

	if (
		selectedOption.kind === "allow_once" ||
		selectedOption.kind === "allow_always"
	) {
		state.grantedExecuteToolCallIds.add(toolCallId);
		state.rejectedExecuteToolCallIds.delete(toolCallId);
	} else if (
		selectedOption.kind === "reject_once" ||
		selectedOption.kind === "reject_always"
	) {
		state.grantedExecuteToolCallIds.delete(toolCallId);
		state.rejectedExecuteToolCallIds.add(toolCallId);
	}
}

function getCommandFromRawInput(rawInput: unknown): string | null {
	const input = (rawInput as Record<string, unknown> | undefined) || {};
	if (typeof input.command !== "string") {
		return null;
	}
	const command = input.command.trim();
	return command.length > 0 ? command : null;
}

function isTerminalPermissionRequest(
	params: acp.RequestPermissionRequest,
): boolean {
	const toolCall = params.toolCall;
	if (!toolCall) {
		return false;
	}
	if (toolCall.kind === "execute") {
		return true;
	}

	const command = getCommandFromRawInput(toolCall.rawInput);
	if (command) {
		return true;
	}

	const title = toolCall.title?.toLowerCase() || "";
	return /\b(terminal|shell|bash|command)\b/.test(title);
}
