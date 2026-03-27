/**
 * Hook for managing the complete agent interaction lifecycle.
 *
 * Combines session management (create/close/restart, config options)
 * and message management (send/receive, streaming, permissions)
 * into a single hook that owns all agent-related state.
 *
 * This is the primary hook called by ChatPanel.
 */

import * as React from "react";
const { useState, useCallback, useMemo, useRef, useEffect } = React;

import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionUpdate,
	SessionConfigOption,
} from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { IVaultAccess, NoteMetadata } from "../services/vault-service";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import type { IMentionService } from "../utils/mention-parser";
import { preparePrompt, sendPreparedPrompt } from "../services/message-sender";
import { Platform } from "obsidian";
import {
	type AgentDisplayInfo,
	getDefaultAgentId,
	getAvailableAgentsFromSettings,
	getCurrentAgent,
	findAgentSettings,
	buildAgentConfigWithApiKey,
	createInitialSession,
} from "../services/session-helpers";
import {
	applyLegacyValue,
	tryRestoreConfigOption,
	restoreLegacyConfig,
} from "../services/session-state";
import {
	applyUpdateLastMessage,
	applyUpsertToolCall,
	rebuildToolCallIndex,
	applySingleUpdate,
	findActivePermission,
	selectOption,
} from "../services/message-state";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;
	/** Vault base path for mention resolution */
	vaultBasePath: string;
	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
	/** Attached images (Base64 embedded) */
	images?: ImagePromptContent[];
	/** Attached file references (resource links) */
	resourceLinks?: ResourceLinkPromptContent[];
}

/**
 * Return type for useAgent hook.
 */
export interface UseAgentReturn {
	// Session state
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;

	// Message state
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Last user message (can be restored after cancel) */
	lastUserMessage: string | null;

	// Combined error (session errors and message errors)
	/** Error information from any operation */
	errorInfo: ErrorInfo | null;

	// Session lifecycle
	createSession: (overrideAgentId?: string) => Promise<void>;
	restartSession: (newAgentId?: string) => Promise<void>;
	closeSession: () => Promise<void>;
	forceRestartAgent: () => Promise<void>;
	cancelOperation: () => Promise<void>;
	getAvailableAgents: () => AgentDisplayInfo[];
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	) => void;

	// Config (including legacy)
	/** DEPRECATED: Use setConfigOption instead. */
	setMode: (modeId: string) => Promise<void>;
	/** DEPRECATED: Use setConfigOption instead. */
	setModel: (modelId: string) => Promise<void>;
	setConfigOption: (configId: string, value: string) => Promise<void>;

	// Message operations
	sendMessage: (content: string, options: SendMessageOptions) => Promise<void>;
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
	// Session State
	// ============================================================

	const initialSettings = settingsAccess.getSnapshot();
	const effectiveInitialAgentId =
		initialAgentId || getDefaultAgentId(initialSettings);
	const initialAgent = getCurrentAgent(
		initialSettings,
		effectiveInitialAgentId,
	);

	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			effectiveInitialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	const isReady = session.state === "ready";

	// ============================================================
	// Message State
	// ============================================================

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);

	// Tool call index: toolCallId → message index for O(1) lookup
	const toolCallIndexRef = useRef<Map<string, number>>(new Map());

	// Ignore updates flag (used during session/load to skip history replay)
	const ignoreUpdatesRef = useRef(false);

	// ============================================================
	// Combined Error State
	// ============================================================

	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	// ============================================================
	// Streaming Update Batching
	// ============================================================

	const pendingUpdatesRef = useRef<SessionUpdate[]>([]);
	const flushScheduledRef = useRef(false);

	const flushPendingUpdates = useCallback(() => {
		flushScheduledRef.current = false;
		const updates = pendingUpdatesRef.current;
		if (updates.length === 0) return;
		pendingUpdatesRef.current = [];

		setMessages((prev) => {
			let result = prev;
			for (const update of updates) {
				result = applySingleUpdate(result, update, toolCallIndexRef.current);
			}
			return result;
		});
	}, []);

	const enqueueUpdate = useCallback(
		(update: SessionUpdate) => {
			pendingUpdatesRef.current.push(update);
			if (!flushScheduledRef.current) {
				flushScheduledRef.current = true;
				requestAnimationFrame(flushPendingUpdates);
			}
		},
		[flushPendingUpdates],
	);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			pendingUpdatesRef.current = [];
			flushScheduledRef.current = false;
			toolCallIndexRef.current.clear();
		};
	}, []);

	// ============================================================
	// Session Update Handler (unified)
	// ============================================================

	const handleSessionUpdate = useCallback(
		(update: SessionUpdate) => {
			// Session-level updates
			switch (update.type) {
				case "available_commands_update":
					setSession((prev) => ({
						...prev,
						availableCommands: update.commands,
					}));
					break;
				case "current_mode_update":
					setSession((prev) => {
						if (!prev.modes) return prev;
						return {
							...prev,
							modes: {
								...prev.modes,
								currentModeId: update.currentModeId,
							},
						};
					});
					break;
				case "config_option_update":
					setSession((prev) => ({
						...prev,
						configOptions: update.configOptions,
					}));
					break;
				case "usage_update":
					setSession((prev) => ({
						...prev,
						usage: {
							used: update.used,
							size: update.size,
							cost: update.cost ?? undefined,
						},
					}));
					break;
				case "process_error":
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: update.error.title || "Agent Error",
						message: update.error.message || "An error occurred",
						suggestion: update.error.suggestion,
					});
					break;
			}

			// Message-level updates (batched via RAF)
			if (!ignoreUpdatesRef.current) {
				enqueueUpdate(update);
			}
		},
		[enqueueUpdate],
	);

	// Subscribe to all updates from agent
	useEffect(() => {
		const unsubscribe = agentClient.onSessionUpdate(handleSessionUpdate);
		return unsubscribe;
	}, [agentClient, handleSessionUpdate]);

	// ============================================================
	// Session Lifecycle
	// ============================================================

	const createSession = useCallback(
		async (overrideAgentId?: string) => {
			const settings = settingsAccess.getSnapshot();
			const agentId = overrideAgentId || getDefaultAgentId(settings);
			const currentAgent = getCurrentAgent(settings, agentId);

			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				agentId: agentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
				usage: undefined,
				promptCapabilities: prev.promptCapabilities,
				agentCapabilities: prev.agentCapabilities,
				agentInfo: prev.agentInfo,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
				const agentSettings = findAgentSettings(settings, agentId);

				if (!agentSettings) {
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${agentId}" not found in settings`,
						suggestion:
							"Please check your agent configuration in settings.",
					});
					return;
				}

				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					workingDirectory,
				);

				const initResult =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== agentId
						? await agentClient.initialize(agentConfig)
						: null;

				const sessionResult =
					await agentClient.newSession(workingDirectory);

				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					authMethods: initResult?.authMethods ?? [],
					modes: sessionResult.modes,
					models: sessionResult.models,
					configOptions: sessionResult.configOptions,
					promptCapabilities: initResult
						? initResult.promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: initResult
						? initResult.agentCapabilities
						: prev.agentCapabilities,
					agentInfo: initResult
						? initResult.agentInfo
						: prev.agentInfo,
					lastActivityAt: new Date(),
				}));

				// Restore last used config (model/mode)
				if (sessionResult.configOptions && sessionResult.sessionId) {
					let configOptions = sessionResult.configOptions;
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"model",
						settings.lastUsedModels[agentId],
					);
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"mode",
						settings.lastUsedModes[agentId],
					);
					if (configOptions !== sessionResult.configOptions) {
						setSession((prev) => ({
							...prev,
							configOptions,
						}));
					}
				} else if (sessionResult.sessionId) {
					await restoreLegacyConfig(
						agentClient,
						sessionResult,
						settings.lastUsedModels[agentId],
						settings.lastUsedModes[agentId],
						setSession,
					);
				}
			} catch (error) {
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Session Creation Failed",
					message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion:
						"Please check the agent configuration and try again.",
				});
			}
		},
		[agentClient, settingsAccess, workingDirectory],
	);

	const restartSession = useCallback(
		async (newAgentId?: string) => {
			await createSession(newAgentId);
		},
		[createSession],
	);

	const closeSession = useCallback(async () => {
		if (session.sessionId) {
			try {
				await agentClient.cancel(session.sessionId);
			} catch (error) {
				console.warn("Failed to cancel session:", error);
			}
		}
		try {
			await agentClient.disconnect();
		} catch (error) {
			console.warn("Failed to disconnect:", error);
		}
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "disconnected",
		}));
	}, [agentClient, session.sessionId]);

	const forceRestartAgent = useCallback(async () => {
		const currentAgentId = session.agentId;
		await agentClient.disconnect();
		await createSession(currentAgentId);
	}, [agentClient, session.agentId, createSession]);

	const cancelOperation = useCallback(async () => {
		if (!session.sessionId) return;
		try {
			await agentClient.cancel(session.sessionId);
			setSession((prev) => ({ ...prev, state: "ready" }));
		} catch (error) {
			console.warn("Failed to cancel operation:", error);
			setSession((prev) => ({ ...prev, state: "ready" }));
		}
	}, [agentClient, session.sessionId]);

	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	const updateSessionFromLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			setSession((prev) => ({
				...prev,
				sessionId,
				state: "ready",
				modes: modes ?? prev.modes,
				models: models ?? prev.models,
				configOptions: configOptions ?? prev.configOptions,
				lastActivityAt: new Date(),
			}));
		},
		[],
	);

	// ============================================================
	// Config (including legacy)
	// ============================================================

	const setLegacyConfigValue = useCallback(
		async (kind: "mode" | "model", value: string) => {
			if (!session.sessionId) {
				console.warn(`Cannot set ${kind}: no active session`);
				return;
			}

			const previousValue =
				kind === "mode"
					? session.modes?.currentModeId
					: session.models?.currentModelId;

			setSession((prev) => applyLegacyValue(prev, kind, value));

			try {
				if (kind === "mode") {
					await agentClient.setSessionMode(
						session.sessionId,
						value,
					);
				} else {
					await agentClient.setSessionModel(
						session.sessionId,
						value,
					);
				}

				if (session.agentId) {
					const persistKey =
						kind === "mode"
							? "lastUsedModes"
							: "lastUsedModels";
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						[persistKey]: {
							...currentSettings[persistKey],
							[session.agentId]: value,
						},
					});
				}
			} catch (error) {
				console.error(`Failed to set ${kind}:`, error);
				if (previousValue) {
					setSession((prev) =>
						applyLegacyValue(prev, kind, previousValue),
					);
				}
			}
		},
		[
			agentClient,
			session.sessionId,
			session.modes?.currentModeId,
			session.models?.currentModelId,
			settingsAccess,
			session.agentId,
		],
	);

	const setMode = useCallback(
		(modeId: string) => setLegacyConfigValue("mode", modeId),
		[setLegacyConfigValue],
	);

	const setModel = useCallback(
		(modelId: string) => setLegacyConfigValue("model", modelId),
		[setLegacyConfigValue],
	);

	const setConfigOption = useCallback(
		async (configId: string, value: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set config option: no active session");
				return;
			}

			const previousConfigOptions = session.configOptions;

			setSession((prev) => {
				if (!prev.configOptions) return prev;
				return {
					...prev,
					configOptions: prev.configOptions.map((opt) =>
						opt.id === configId
							? { ...opt, currentValue: value }
							: opt,
					),
				};
			});

			try {
				const updatedOptions = await agentClient.setSessionConfigOption(
					session.sessionId,
					configId,
					value,
				);
				setSession((prev) => ({
					...prev,
					configOptions: updatedOptions,
				}));

				const changedOption = updatedOptions.find(
					(o) => o.id === configId,
				);
				if (changedOption?.category === "model" && session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModels: {
							...currentSettings.lastUsedModels,
							[session.agentId]: value,
						},
					});
				}
				if (changedOption?.category === "mode" && session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModes: {
							...currentSettings.lastUsedModes,
							[session.agentId]: value,
						},
					});
				}
			} catch (error) {
				console.error("Failed to set config option:", error);
				if (previousConfigOptions) {
					setSession((prev) => ({
						...prev,
						configOptions: previousConfigOptions,
					}));
				}
			}
		},
		[
			agentClient,
			session.sessionId,
			session.configOptions,
			settingsAccess,
			session.agentId,
		],
	);

	// ============================================================
	// Message Operations
	// ============================================================

	const addMessage = useCallback((message: ChatMessage): void => {
		setMessages((prev) => [...prev, message]);
	}, []);

	const updateLastMessage = useCallback((content: MessageContent): void => {
		setMessages((prev) => applyUpdateLastMessage(prev, content));
	}, []);

	const upsertToolCall = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;
			setMessages((prev) =>
				applyUpsertToolCall(prev, content, toolCallIndexRef.current),
			);
		},
		[],
	);

	const setIgnoreUpdates = useCallback((ignore: boolean): void => {
		ignoreUpdatesRef.current = ignore;
	}, []);

	const clearMessages = useCallback((): void => {
		setMessages([]);
		toolCallIndexRef.current.clear();
		setLastUserMessage(null);
		setIsSending(false);
		setErrorInfo(null);
	}, []);

	const setInitialMessages = useCallback(
		(
			history: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp?: string;
			}>,
		): void => {
			const chatMessages: ChatMessage[] = history.map((msg) => ({
				id: crypto.randomUUID(),
				role: msg.role as "user" | "assistant",
				content: msg.content.map((c) => ({
					type: c.type as "text",
					text: c.text,
				})),
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
			}));

			setMessages(chatMessages);
			rebuildToolCallIndex(chatMessages, toolCallIndexRef.current);
			setIsSending(false);
			setErrorInfo(null);
		},
		[],
	);

	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			setMessages(localMessages);
			rebuildToolCallIndex(localMessages, toolCallIndexRef.current);
			setIsSending(false);
			setErrorInfo(null);
		},
		[],
	);

	const clearError = useCallback((): void => {
		setErrorInfo(null);
	}, []);

	const shouldConvertToWsl = useMemo(() => {
		const settings = settingsAccess.getSnapshot();
		return Platform.isWin && settings.windowsWslMode;
	}, [settingsAccess]);

	const sendMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			if (!session.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			const settings = settingsAccess.getSnapshot();

			const prepared = await preparePrompt(
				{
					message: content,
					images: options.images,
					resourceLinks: options.resourceLinks,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
					supportsEmbeddedContext:
						session.promptCapabilities?.embeddedContext ?? false,
					maxNoteLength: settings.displaySettings.maxNoteLength,
					maxSelectionLength:
						settings.displaySettings.maxSelectionLength,
				},
				vaultAccess,
				vaultAccess, // IMentionService (same object)
			);

			const userMessageContent: MessageContent[] = [];

			if (prepared.autoMentionContext) {
				userMessageContent.push({
					type: "text_with_context",
					text: content,
					autoMentionContext: prepared.autoMentionContext,
				});
			} else {
				userMessageContent.push({
					type: "text",
					text: content,
				});
			}

			if (options.images && options.images.length > 0) {
				for (const img of options.images) {
					userMessageContent.push({
						type: "image",
						data: img.data,
						mimeType: img.mimeType,
					});
				}
			}

			if (options.resourceLinks && options.resourceLinks.length > 0) {
				for (const link of options.resourceLinks) {
					userMessageContent.push({
						type: "resource_link",
						uri: link.uri,
						name: link.name,
						mimeType: link.mimeType,
						size: link.size,
					});
				}
			}

			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: userMessageContent,
				timestamp: new Date(),
			};
			addMessage(userMessage);

			setIsSending(true);
			setLastUserMessage(content);

			try {
				const result = await sendPreparedPrompt(
					{
						sessionId: session.sessionId,
						agentContent: prepared.agentContent,
						displayContent: prepared.displayContent,
						authMethods: session.authMethods,
					},
					agentClient,
				);

				if (result.success) {
					setIsSending(false);
					setLastUserMessage(null);
				} else {
					setIsSending(false);
					setErrorInfo(
						result.error
							? {
									title: result.error.title,
									message: result.error.message,
									suggestion: result.error.suggestion,
								}
							: {
									title: "Send Message Failed",
									message: "Failed to send message",
								},
					);
				}
			} catch (error) {
				setIsSending(false);
				setErrorInfo({
					title: "Send Message Failed",
					message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[
			agentClient,
			vaultAccess,
			settingsAccess,
			session.sessionId,
			session.authMethods,
			session.promptCapabilities,
			shouldConvertToWsl,
			addMessage,
		],
	);

	// ============================================================
	// Permission State & Operations
	// ============================================================

	const activePermission = useMemo(
		() => findActivePermission(messages),
		[messages],
	);

	const hasActivePermission = activePermission !== null;

	const approvePermission = useCallback(
		async (requestId: string, optionId: string): Promise<void> => {
			try {
				await agentClient.respondToPermission(requestId, optionId);
			} catch (error) {
				setErrorInfo({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[agentClient],
	);

	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(activePermission.options, [
			"allow_once",
			"allow_always",
		]);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(
			activePermission.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	// ============================================================
	// Return
	// ============================================================

	return {
		// Session state
		session,
		isReady,

		// Message state
		messages,
		isSending,
		lastUserMessage,

		// Combined error
		errorInfo,

		// Session lifecycle
		createSession,
		restartSession,
		closeSession,
		forceRestartAgent,
		cancelOperation,
		getAvailableAgents,
		updateSessionFromLoad,

		// Config
		setMode,
		setModel,
		setConfigOption,

		// Message operations
		sendMessage,
		clearMessages,
		setInitialMessages,
		setMessagesFromLocal,
		clearError,
		setIgnoreUpdates,

		// Permission
		activePermission,
		hasActivePermission,
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
	};
}
