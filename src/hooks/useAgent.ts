/**
 * Hook for managing the complete agent interaction lifecycle.
 *
 * This is a facade that composes useAgentSession and useAgentMessages,
 * providing a unified API to ChatPanel.
 */

import * as React from "react";
const { useState, useCallback, useEffect, useMemo } = React;

import type { SessionUpdate } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { IVaultAccess } from "../services/vault-service";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import type { IMentionService } from "../utils/mention-parser";
import { useAgentSession } from "./useAgentSession";
import { useAgentMessages, type SendMessageOptions } from "./useAgentMessages";

// Re-export types that ChatPanel uses
export type { SendMessageOptions } from "./useAgentMessages";
export type { AgentDisplayInfo } from "../services/session-helpers";

// ============================================================================
// Types
// ============================================================================

import type { ChatMessage, ActivePermission } from "../types/chat";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionConfigOption,
} from "../types/session";
import type { AgentDisplayInfo } from "../services/session-helpers";

/**
 * Return type for useAgent hook.
 */
export interface UseAgentReturn {
	// Session state
	session: ChatSession;
	isReady: boolean;

	// Message state
	messages: ChatMessage[];
	isSending: boolean;
	lastUserMessage: string | null;

	// Combined error
	errorInfo: ErrorInfo | null;

	// Session lifecycle
	createSession: (
		overrideAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	restartSession: (
		newAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	closeSession: () => Promise<void>;
	forceRestartAgent: () => Promise<void>;
	cancelOperation: () => Promise<void>;
	getAvailableAgents: () => AgentDisplayInfo[];
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	) => Promise<void>;

	// Config
	setMode: (modeId: string) => Promise<void>;
	setModel: (modelId: string) => Promise<void>;
	setConfigOption: (configId: string, value: string) => Promise<void>;

	// Message operations
	sendMessage: (
		content: string,
		options: SendMessageOptions,
	) => Promise<void>;
	clearMessages: () => void;
	setInitialMessages: (
		history: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	) => void;
	setMessagesFromLocal: (localMessages: ChatMessage[]) => void;
	clearError: () => void;
	setIgnoreUpdates: (ignore: boolean) => void;
	/** Discard any pending RAF updates and reset streaming state (call after stop/cancel). */
	clearPendingUpdates: () => void;

	// Permission
	activePermission: ActivePermission | null;
	hasActivePermission: boolean;
	approvePermission: (requestId: string, optionId: string) => Promise<void>;
	approveActivePermission: () => Promise<boolean>;
	rejectActivePermission: () => Promise<boolean>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * @param agentClient - Agent client for communication
 * @param settingsAccess - Settings access for agent configuration
 * @param vaultAccess - Vault access for reading notes (also serves as IMentionService)
 * @param workingDirectory - Working directory for the session
 * @param initialAgentId - Optional initial agent ID (from view persistence)
 */
export function useAgent(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	vaultAccess: IVaultAccess & IMentionService,
	workingDirectory: string,
	initialAgentId?: string,
): UseAgentReturn {
	// ============================================================
	// Shared Error State
	// ============================================================

	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	// ============================================================
	// Sub-hooks
	// ============================================================

	const agentSession = useAgentSession(
		agentClient,
		settingsAccess,
		workingDirectory,
		setErrorInfo,
		initialAgentId,
	);

	const agentMessages = useAgentMessages(
		agentClient,
		settingsAccess,
		vaultAccess,
		agentSession.session,
		setErrorInfo,
	);

	// ============================================================
	// Unified Session Update Handler
	// ============================================================

	const handleSessionUpdate = useCallback(
		(update: SessionUpdate) => {
			// Session-level updates (commands, mode, config, usage, error)
			agentSession.handleSessionUpdate(update);

			// Message-level updates (batched via RAF, ignoreUpdates checked internally)
			agentMessages.enqueueUpdate(update);
		},
		[agentSession.handleSessionUpdate, agentMessages.enqueueUpdate],
	);

	// Subscribe to all updates from agent
	useEffect(() => {
		const unsubscribe = agentClient.onSessionUpdate(handleSessionUpdate);
		return unsubscribe;
	}, [agentClient, handleSessionUpdate]);

	// ============================================================
	// Return
	// ============================================================

	return useMemo(
		() => ({
			// Session state
			session: agentSession.session,
			isReady: agentSession.isReady,

			// Message state
			messages: agentMessages.messages,
			isSending: agentMessages.isSending,
			lastUserMessage: agentMessages.lastUserMessage,

			// Combined error
			errorInfo,

			// Session lifecycle
			createSession: agentSession.createSession,
			restartSession: agentSession.restartSession,
			closeSession: agentSession.closeSession,
			forceRestartAgent: agentSession.forceRestartAgent,
			cancelOperation: agentSession.cancelOperation,
			getAvailableAgents: agentSession.getAvailableAgents,
			updateSessionFromLoad: agentSession.updateSessionFromLoad,

			// Config
			setMode: agentSession.setMode,
			setModel: agentSession.setModel,
			setConfigOption: agentSession.setConfigOption,

			// Message operations
			sendMessage: agentMessages.sendMessage,
			clearMessages: agentMessages.clearMessages,
			setInitialMessages: agentMessages.setInitialMessages,
			setMessagesFromLocal: agentMessages.setMessagesFromLocal,
			clearError: agentMessages.clearError,
			setIgnoreUpdates: agentMessages.setIgnoreUpdates,
			clearPendingUpdates: agentMessages.clearPendingUpdates,

			// Permission
			activePermission: agentMessages.activePermission,
			hasActivePermission: agentMessages.hasActivePermission,
			approvePermission: agentMessages.approvePermission,
			approveActivePermission: agentMessages.approveActivePermission,
			rejectActivePermission: agentMessages.rejectActivePermission,
		}),
		[
			agentSession.session,
			agentSession.isReady,
			agentMessages.messages,
			agentMessages.isSending,
			agentMessages.lastUserMessage,
			errorInfo,
			agentSession.createSession,
			agentSession.restartSession,
			agentSession.closeSession,
			agentSession.forceRestartAgent,
			agentSession.cancelOperation,
			agentSession.getAvailableAgents,
			agentSession.updateSessionFromLoad,
			agentSession.setMode,
			agentSession.setModel,
			agentSession.setConfigOption,
			agentMessages.sendMessage,
			agentMessages.clearMessages,
			agentMessages.setInitialMessages,
			agentMessages.setMessagesFromLocal,
			agentMessages.clearError,
			agentMessages.clearPendingUpdates,
			agentMessages.setIgnoreUpdates,
			agentMessages.activePermission,
			agentMessages.hasActivePermission,
			agentMessages.approvePermission,
			agentMessages.approveActivePermission,
			agentMessages.rejectActivePermission,
		],
	);
}
