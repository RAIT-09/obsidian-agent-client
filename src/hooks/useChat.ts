/**
 * useChat Hook
 *
 * Combines all chat-related hooks into a single unified API.
 * This hook serves as a bridge between the new hooks architecture
 * and the existing ChatView component.
 *
 * Note: This hook is standalone and does NOT depend on ChatContext.
 * It manages all chat state internally.
 */

import { useMemo, useCallback, useEffect, useState } from "react";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";
import type {
	ChatMessage,
	SlashCommand,
	NoteMetadata,
	PermissionOption,
} from "../types";
import type { IAcpClient } from "../adapters/acp/acp.adapter";

import { useMessages } from "./useMessages";
import { useSession } from "./useSession";

// Import use cases
import { SendMessageUseCase } from "../core/use-cases/send-message.use-case";
import { ManageSessionUseCase } from "../core/use-cases/manage-session.use-case";
import { HandlePermissionUseCase } from "../core/use-cases/handle-permission.use-case";
import { SwitchAgentUseCase } from "../core/use-cases/switch-agent.use-case";

// Import adapters
import { AcpAdapter } from "../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../adapters/obsidian/vault.adapter";
import { NoteMentionService } from "../adapters/obsidian/mention-service";

// ============================================================================
// Types
// ============================================================================

export interface UseChatOptions {
	/** Plugin instance */
	plugin: AgentClientPlugin;

	/** Working directory for the agent */
	workingDirectory: string;
}

export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;

	/** Vault base path for mention resolution */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useChat(options: UseChatOptions) {
	const { plugin, workingDirectory } = options;

	// ========================================
	// Initialize Core Hooks
	// ========================================

	const messagesHook = useMessages();
	const {
		messages,
		addMessage,
		updateLastMessage,
		updateMessage,
		clearMessages,
		setLastUserMessage,
	} = messagesHook;

	// Get initial agent info
	const initialAgentId = plugin.settings.activeAgentId;
	const initialAgentDisplayName = useMemo(() => {
		const settings = plugin.settings;
		if (initialAgentId === settings.claude.id)
			return settings.claude.displayName;
		if (initialAgentId === settings.codex.id)
			return settings.codex.displayName;
		if (initialAgentId === settings.gemini.id)
			return settings.gemini.displayName;
		const custom = settings.customAgents.find(
			(a) => a.id === initialAgentId,
		);
		return custom?.displayName || initialAgentId;
	}, [plugin.settings, initialAgentId]);

	const sessionHook = useSession({
		agentId: initialAgentId,
		agentDisplayName: initialAgentDisplayName,
		workingDirectory,
	});

	// Slash commands state (standalone, not using ChatContext)
	const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>(
		[],
	);

	// ========================================
	// Initialize Adapters and Use Cases (memoized)
	// ========================================

	const { acpAdapter, vaultAdapter, mentionService, useCases } =
		useMemo(() => {
			// Create adapters
			const mentionSvc = new NoteMentionService(plugin);
			const vaultAdp = new ObsidianVaultAdapter(plugin);
			const acpAdp = new AcpAdapter(plugin);

			// Create use cases
			const sendMessageUC = new SendMessageUseCase(
				acpAdp,
				vaultAdp,
				plugin.settingsStore,
				mentionSvc,
			);
			const manageSessionUC = new ManageSessionUseCase(
				acpAdp,
				plugin.settingsStore,
			);
			const handlePermissionUC = new HandlePermissionUseCase(
				acpAdp,
				plugin.settingsStore,
			);
			const switchAgentUC = new SwitchAgentUseCase(plugin.settingsStore);

			return {
				acpAdapter: acpAdp,
				vaultAdapter: vaultAdp,
				mentionService: mentionSvc,
				useCases: {
					sendMessage: sendMessageUC,
					manageSession: manageSessionUC,
					handlePermission: handlePermissionUC,
					switchAgent: switchAgentUC,
				},
			};
		}, [plugin]);

	// Store ACP adapter reference on plugin for external access
	useEffect(() => {
		plugin.acpAdapter = acpAdapter;
		return () => {
			plugin.acpAdapter = null;
		};
	}, [plugin, acpAdapter]);

	// ========================================
	// Wire up ACP callbacks
	// ========================================

	useEffect(() => {
		acpAdapter.setMessageCallbacks(
			addMessage,
			updateLastMessage,
			updateMessage,
			(commands: SlashCommand[]) => {
				sessionHook.setAvailableCommands(commands);
				setAvailableCommands(commands);
			},
		);
	}, [acpAdapter, addMessage, updateLastMessage, updateMessage, sessionHook]);

	// ========================================
	// Session Actions
	// ========================================

	const createNewSession = useCallback(async () => {
		const activeAgentId = useCases.switchAgent.getActiveAgentId();
		const currentAgent = useCases.switchAgent.getCurrentAgent();

		// Reset UI immediately
		clearMessages();
		sessionHook.resetSession(activeAgentId, currentAgent.displayName);
		setAvailableCommands([]);

		try {
			const result = await useCases.manageSession.createSession({
				workingDirectory,
				agentId: activeAgentId,
			});

			if (result.success && result.sessionId) {
				sessionHook.markReady(
					result.sessionId,
					result.authMethods || [],
				);
			} else {
				sessionHook.setSessionState("error");
				sessionHook.setError(
					result.error || {
						title: "Session Creation Failed",
						message: "Failed to create new session",
						suggestion: "Please try again.",
					},
				);
			}
		} catch (error) {
			sessionHook.setSessionState("error");
			sessionHook.setError({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [useCases, workingDirectory, clearMessages, sessionHook]);

	const cancelCurrentOperation = useCallback(async () => {
		const { session } = sessionHook;
		if (!session.sessionId) return;

		try {
			await useCases.manageSession.closeSession(session.sessionId);
			sessionHook.setSending(false);
			sessionHook.setSessionState("ready");
		} catch (error) {
			console.warn("Failed to cancel operation:", error);
			sessionHook.setSending(false);
			sessionHook.setSessionState("ready");
		}
	}, [useCases, sessionHook]);

	const disconnect = useCallback(async () => {
		await useCases.manageSession.closeSession(
			sessionHook.session.sessionId,
		);
		await useCases.manageSession.disconnect();
		sessionHook.markDisconnected();
	}, [useCases, sessionHook]);

	/**
	 * Restart session - cancel current and create new.
	 */
	const restartSession = useCallback(async () => {
		const { session } = sessionHook;
		if (session.sessionId) {
			try {
				await useCases.manageSession.closeSession(session.sessionId);
			} catch (error) {
				console.warn("Failed to close session during restart:", error);
			}
		}
		await createNewSession();
	}, [useCases, sessionHook, createNewSession]);

	/**
	 * Dispose - cleanup all resources.
	 * Called when the view is being closed.
	 */
	const dispose = useCallback(async () => {
		try {
			const { session } = sessionHook;
			if (session.sessionId) {
				await useCases.manageSession.closeSession(session.sessionId);
			}
			await useCases.manageSession.disconnect();
		} catch (error) {
			console.warn("Error during dispose:", error);
		}
	}, [useCases, sessionHook]);

	// ========================================
	// Message Actions
	// ========================================

	const sendMessage = useCallback(
		async (content: string, sendOptions: SendMessageOptions) => {
			const { session, canSendMessage } = sessionHook;

			if (!canSendMessage || !session.sessionId) {
				return;
			}

			// Phase 1: Prepare message
			const prepared = await useCases.sendMessage.prepareMessage({
				message: content,
				activeNote: sendOptions.activeNote,
				vaultBasePath: sendOptions.vaultBasePath,
				isAutoMentionDisabled: sendOptions.isAutoMentionDisabled,
				convertToWsl: plugin.settings.windowsWslMode,
			});

			// Phase 2: Add user message to UI
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
			addMessage(userMessage);

			// Phase 3: Set sending state
			sessionHook.setSending(true);
			sessionHook.setSessionState("busy");
			setLastUserMessage(content);

			// Phase 4: Send to agent
			try {
				const result = await useCases.sendMessage.sendPreparedMessage({
					sessionId: session.sessionId,
					agentMessage: prepared.agentMessage,
					displayMessage: prepared.displayMessage,
					authMethods: session.authMethods,
				});

				if (result.success) {
					sessionHook.setSending(false);
					sessionHook.setSessionState("ready");
					sessionHook.updateActivity();
					setLastUserMessage(null);
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
		[
			useCases,
			plugin.settings,
			sessionHook,
			addMessage,
			setLastUserMessage,
		],
	);

	// ========================================
	// Permission Actions
	// ========================================

	/**
	 * Find the active permission request in current messages.
	 */
	const findActivePermission = useCallback((): {
		requestId: string;
		options: PermissionOption[];
	} | null => {
		for (const message of messages) {
			for (const content of message.content) {
				if (content.type === "tool_call") {
					const permission = content.permissionRequest;
					if (permission?.isActive) {
						return {
							requestId: permission.requestId,
							options: permission.options,
						};
					}
				}
			}
		}
		return null;
	}, [messages]);

	/**
	 * Select an option from permission options based on preferred kinds.
	 */
	const selectOption = useCallback(
		(
			options: PermissionOption[],
			preferredKinds: PermissionOption["kind"][],
			fallback?: (option: PermissionOption) => boolean,
		): PermissionOption | undefined => {
			for (const kind of preferredKinds) {
				const match = options.find((opt) => opt.kind === kind);
				if (match) {
					return match;
				}
			}
			if (fallback) {
				const fallbackOption = options.find(fallback);
				if (fallbackOption) {
					return fallbackOption;
				}
			}
			return options[0];
		},
		[],
	);

	const approvePermission = useCallback(
		async (requestId: string, optionId: string) => {
			try {
				const result =
					await useCases.handlePermission.approvePermission({
						requestId,
						optionId,
					});

				if (!result.success) {
					sessionHook.setError({
						title: "Permission Error",
						message:
							result.error ||
							"Failed to respond to permission request",
					});
				}
			} catch (error) {
				sessionHook.setError({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[useCases, sessionHook],
	);

	/**
	 * Approve the currently active permission request.
	 * Selects the first "allow" option.
	 */
	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		const active = findActivePermission();
		if (!active || active.options.length === 0) {
			return false;
		}

		const option = selectOption(active.options, [
			"allow_once",
			"allow_always",
		]);

		if (!option) {
			return false;
		}

		await approvePermission(active.requestId, option.optionId);
		return true;
	}, [findActivePermission, selectOption, approvePermission]);

	/**
	 * Reject the currently active permission request.
	 * Selects the first "reject" option.
	 */
	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		const active = findActivePermission();
		if (!active || active.options.length === 0) {
			return false;
		}

		const option = selectOption(
			active.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);

		if (!option) {
			return false;
		}

		await approvePermission(active.requestId, option.optionId);
		return true;
	}, [findActivePermission, selectOption, approvePermission]);

	// ========================================
	// Agent Actions
	// ========================================

	const switchAgent = useCallback(
		async (agentId: string) => {
			await useCases.switchAgent.switchAgent(agentId);
			sessionHook.setSession({
				agentId,
				availableCommands: undefined,
			});
			setAvailableCommands([]);
		},
		[useCases, sessionHook],
	);

	const getAvailableAgents = useCallback(() => {
		return useCases.switchAgent.getAvailableAgents();
	}, [useCases]);

	// ========================================
	// Return Combined API
	// ========================================

	return {
		// State
		messages,
		session: sessionHook.session,
		errorInfo: sessionHook.errorInfo,
		isSending: sessionHook.isSending,
		lastUserMessage: messagesHook.lastUserMessage,
		availableCommands,

		// Computed
		isReady: sessionHook.isReady,
		canSendMessage: sessionHook.canSendMessage,

		// Session actions
		createNewSession,
		restartSession,
		cancelCurrentOperation,
		disconnect,
		dispose,

		// Message actions
		sendMessage,
		addMessage,
		updateLastMessage,
		updateMessage,
		clearMessages,

		// Permission actions
		approvePermission,
		approveActivePermission,
		rejectActivePermission,

		// Agent actions
		switchAgent,
		getAvailableAgents,

		// Error actions
		clearError: sessionHook.clearError,

		// Adapters (for external access)
		acpAdapter,
		acpClient: acpAdapter as IAcpClient,
		vaultAdapter,
		mentionService,

		// Use cases (for HandlePermissionUseCase access in components)
		handlePermissionUseCase: useCases.handlePermission,
	};
}

export type UseChatReturn = ReturnType<typeof useChat>;
