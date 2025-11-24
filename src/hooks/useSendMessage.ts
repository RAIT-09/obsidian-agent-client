/**
 * useSendMessage Hook
 *
 * Handles sending messages to the AI agent.
 * Integrates with useMessages and useSession hooks.
 */

import { useCallback } from "react";
import type { ChatMessage, NoteMetadata } from "../types";
import type { SendMessageUseCase } from "../core/use-cases/send-message.use-case";
import type { UseMessagesReturn } from "./useMessages";
import type { UseSessionReturn } from "./useSession";

// ============================================================================
// Types
// ============================================================================

export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;

	/** Vault base path for mention resolution */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;

	/** Whether to convert paths to WSL format */
	convertToWsl?: boolean;
}

export interface UseSendMessageOptions {
	/** Send message use case */
	sendMessageUseCase: SendMessageUseCase;

	/** Messages hook return value */
	messagesHook: UseMessagesReturn;

	/** Session hook return value */
	sessionHook: UseSessionReturn;
}

// ============================================================================
// Hook
// ============================================================================

export function useSendMessage(options: UseSendMessageOptions) {
	const { sendMessageUseCase, messagesHook, sessionHook } = options;

	/**
	 * Send a message to the agent.
	 */
	const sendMessage = useCallback(
		async (content: string, sendOptions: SendMessageOptions) => {
			const { session, canSendMessage } = sessionHook;

			if (!canSendMessage || !session.sessionId) {
				return;
			}

			// Phase 1: Prepare message
			const prepared = await sendMessageUseCase.prepareMessage({
				message: content,
				activeNote: sendOptions.activeNote,
				vaultBasePath: sendOptions.vaultBasePath,
				isAutoMentionDisabled: sendOptions.isAutoMentionDisabled,
				convertToWsl: sendOptions.convertToWsl,
			});

			// Phase 2: Add user message to UI immediately
			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: prepared.autoMentionContext
					? [
							{
								type: "text_with_context",
								text: prepared.displayMessage,
								autoMentionContext: prepared.autoMentionContext,
							},
						]
					: [
							{
								type: "text",
								text: prepared.displayMessage,
							},
						],
				timestamp: new Date(),
			};
			messagesHook.addMessage(userMessage);

			// Phase 3: Set sending state
			sessionHook.setSending(true);
			sessionHook.setSessionState("busy");
			messagesHook.setLastUserMessage(content);

			// Phase 4: Send to agent
			try {
				const result = await sendMessageUseCase.sendPreparedMessage({
					sessionId: session.sessionId,
					agentMessage: prepared.agentMessage,
					displayMessage: prepared.displayMessage,
					authMethods: session.authMethods,
				});

				if (result.success) {
					sessionHook.setSending(false);
					sessionHook.setSessionState("ready");
					sessionHook.updateActivity();
					messagesHook.setLastUserMessage(null);
				} else {
					sessionHook.setSending(false);
					sessionHook.setSessionState("ready");
					if (result.error) {
						sessionHook.setError({
							title: result.error.title,
							message: result.error.message,
							suggestion: result.error.suggestion,
						});
					}
				}
			} catch (error) {
				sessionHook.setSending(false);
				sessionHook.setSessionState("ready");
				sessionHook.setError({
					title: "Send Message Failed",
					message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[sendMessageUseCase, messagesHook, sessionHook],
	);

	return {
		sendMessage,
	};
}

export type UseSendMessageReturn = ReturnType<typeof useSendMessage>;
