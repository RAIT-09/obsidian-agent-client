import type { IAgentClient } from "../../../domain/ports/agent-client.port";
import { AcpErrorCode } from "../../../domain/models/agent-error";
import {
	extractErrorCode,
	isEmptyResponseError,
	toAcpError,
} from "../../../shared/acp-error-utils";
import type { PromptContent } from "../../../domain/models/prompt-content";
import type { AuthenticationMethod } from "../../../domain/models/chat-session";
import type { SendPreparedPromptInput, SendPromptResult } from "./types";

export async function sendPreparedPrompt(
	input: SendPreparedPromptInput,
	agentClient: IAgentClient,
): Promise<SendPromptResult> {
	try {
		await agentClient.sendPrompt(input.sessionId, input.agentContent);
		return {
			success: true,
			displayContent: input.displayContent,
			agentContent: input.agentContent,
		};
	} catch (error) {
		return await handleSendError(
			error,
			input.sessionId,
			input.agentContent,
			input.displayContent,
			input.authMethods,
			agentClient,
		);
	}
}

async function handleSendError(
	error: unknown,
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethods: AuthenticationMethod[],
	agentClient: IAgentClient,
): Promise<SendPromptResult> {
	if (isEmptyResponseError(error)) {
		return {
			success: true,
			displayContent,
			agentContent,
		};
	}

	const errorCode = extractErrorCode(error);
	if (errorCode === AcpErrorCode.AUTHENTICATION_REQUIRED) {
		if (authMethods && authMethods.length > 0) {
			if (authMethods.length === 1) {
				const retryResult = await retryWithAuthentication(
					sessionId,
					agentContent,
					displayContent,
					authMethods[0].id,
					agentClient,
				);
				if (retryResult) {
					return retryResult;
				}
			}

			return {
				success: false,
				displayContent,
				agentContent,
				requiresAuth: true,
				error: toAcpError(error, sessionId),
			};
		}
	}

	return {
		success: false,
		displayContent,
		agentContent,
		error: toAcpError(error, sessionId),
	};
}

async function retryWithAuthentication(
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethodId: string,
	agentClient: IAgentClient,
): Promise<SendPromptResult | null> {
	try {
		const authSuccess = await agentClient.authenticate(authMethodId);
		if (!authSuccess) {
			return null;
		}

		await agentClient.sendPrompt(sessionId, agentContent);
		return {
			success: true,
			displayContent,
			agentContent,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		return {
			success: false,
			displayContent,
			agentContent,
			error: toAcpError(retryError, sessionId),
		};
	}
}
