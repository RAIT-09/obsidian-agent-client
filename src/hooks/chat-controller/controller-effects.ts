import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage } from "../../domain/models/chat-message";
import type { SessionUpdate } from "../../domain/models/session-update";
import type {
	ChatSession,
	SlashCommand,
} from "../../domain/models/chat-session";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type { IVaultAccess } from "../../domain/ports/vault-access.port";
import type { Logger } from "../../shared/logger";

interface UseChatControllerEffectsOptions {
	logger: Logger;
	config?: {
		agent?: string;
		model?: string;
	};
	initialAgentId?: string;
	isSessionReady: boolean;
	isLoadingSessionHistory: boolean;
	session: ChatSession;
	modeModelDefaults?: Record<string, Record<string, string>>;
	lastModeModels?: Record<string, Record<string, string>>;
	createSession: (overrideAgentId?: string) => Promise<void>;
	setModel: (modelId: string) => Promise<void>;
	closeSession: () => Promise<void>;
	updateAvailableCommands: (commands: SlashCommand[]) => void;
	updateCurrentMode: (modeId: string) => void;
	handleSessionUpdate: (update: SessionUpdate) => void;
	agentClient: IAgentClient;
	setContextUsage: Dispatch<
		SetStateAction<{
			size: number;
			used: number;
		} | null>
	>;
	isSending: boolean;
	messages: ChatMessage[];
	saveSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
	updateActiveNote: () => Promise<void>;
	vaultAccess: IVaultAccess;
}

export function useChatControllerEffects({
	logger,
	config,
	initialAgentId,
	isSessionReady,
	isLoadingSessionHistory,
	session,
	modeModelDefaults,
	lastModeModels,
	createSession,
	setModel,
	closeSession,
	updateAvailableCommands,
	updateCurrentMode,
	handleSessionUpdate,
	agentClient,
	setContextUsage,
	isSending,
	messages,
	saveSessionMessages,
	updateActiveNote,
	vaultAccess,
}: UseChatControllerEffectsOptions): void {
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void createSession(config?.agent || initialAgentId);
	}, [createSession, config?.agent, initialAgentId, logger]);

	useEffect(() => {
		if (config?.model && isSessionReady && session.models) {
			const modelExists = session.models.availableModels.some(
				(model) => model.modelId === config.model,
			);
			if (modelExists && session.models.currentModelId !== config.model) {
				logger.log("[useChatController] Applying configured model:", config.model);
				void setModel(config.model);
			}
		}
	}, [config?.model, isSessionReady, session.models, setModel, logger]);

	const initialModeModelAppliedSessionRef = useRef<string | null>(null);
	useEffect(() => {
		if (
			!isSessionReady ||
			!session.sessionId ||
			!session.models ||
			!session.agentId
		) {
			return;
		}
		if (initialModeModelAppliedSessionRef.current === session.sessionId) {
			return;
		}
		if (config?.model) {
			initialModeModelAppliedSessionRef.current = session.sessionId;
			return;
		}
		if (!session.modes) {
			initialModeModelAppliedSessionRef.current = session.sessionId;
			return;
		}

		const currentModeId = session.modes.currentModeId;
		if (!currentModeId) {
			return;
		}

		const modeDefaults = modeModelDefaults?.[session.agentId];
		const modeLastModels = lastModeModels?.[session.agentId];
		const targetModelId =
			modeDefaults?.[currentModeId] ?? modeLastModels?.[currentModeId];

		initialModeModelAppliedSessionRef.current = session.sessionId;

		if (
			targetModelId &&
			targetModelId !== session.models.currentModelId &&
			session.models.availableModels.some((model) => model.modelId === targetModelId)
		) {
			logger.log(
				`[useChatController] Initial mode → model: switching to ${targetModelId} for mode ${currentModeId}`,
			);
			void setModel(targetModelId);
		}
	}, [
		config?.model,
		isSessionReady,
		session.sessionId,
		session.agentId,
		session.modes,
		session.models,
		modeModelDefaults,
		lastModeModels,
		setModel,
		logger,
	]);

	const closeSessionRef = useRef(closeSession);
	closeSessionRef.current = closeSession;
	useEffect(() => {
		return () => {
			logger.log("[useChatController] Cleanup: close session");
			void closeSessionRef.current();
		};
	}, [logger]);

	useEffect(() => {
		agentClient.onSessionUpdate((update) => {
			if (session.sessionId && update.sessionId !== session.sessionId) {
				logger.log(
					`[useChatController] Ignoring update for old session: ${update.sessionId} (current: ${session.sessionId})`,
				);
				return;
			}

			if (isLoadingSessionHistory) {
				if (update.type === "available_commands_update") {
					updateAvailableCommands(update.commands);
				} else if (update.type === "current_mode_update") {
					updateCurrentMode(update.currentModeId);
				}
				return;
			}

			if (update.type === "usage_update") {
				setContextUsage({ size: update.size, used: update.used });
				return;
			}

			handleSessionUpdate(update);

			if (update.type === "available_commands_update") {
				updateAvailableCommands(update.commands);
			} else if (update.type === "current_mode_update") {
				updateCurrentMode(update.currentModeId);
			}
		});
	}, [
		agentClient,
		session.sessionId,
		logger,
		isLoadingSessionHistory,
		handleSessionUpdate,
		updateAvailableCommands,
		updateCurrentMode,
		setContextUsage,
	]);

	const prevIsSendingRef = useRef(false);
	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		if (wasSending && !isSending && session.sessionId && messages.length > 0) {
			saveSessionMessages(session.sessionId, messages);
			logger.log(`[useChatController] Session messages saved: ${session.sessionId}`);
		}
	}, [isSending, session.sessionId, messages, saveSessionMessages, logger]);

	useEffect(() => {
		let isMounted = true;

		const refreshActiveNote = async () => {
			if (!isMounted) return;
			await updateActiveNote();
		};

		const unsubscribe = vaultAccess.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [updateActiveNote, vaultAccess]);
}
