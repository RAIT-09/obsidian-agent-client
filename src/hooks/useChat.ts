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
	BaseAgentSettings,
	ClaudeAgentSettings,
	GeminiAgentSettings,
	CodexAgentSettings,
	AuthenticationMethod,
	AgentError,
	EditorPosition,
	IVaultAccess,
} from "../types";
import type { IAcpClient } from "../adapters/acp/acp.adapter";
import { toAgentConfig } from "../shared/settings-utils";
import { extractMentionedNotes, type IMentionService } from "../shared/mention-utils";
import { convertWindowsPathToWsl } from "../shared/wsl-utils";

import { useMessages } from "./useMessages";
import { useSession } from "./useSession";

// Import adapters
import { AcpAdapter } from "../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../adapters/obsidian/vault.adapter";
import { NoteMentionService } from "../adapters/obsidian/mention-service";

// ============================================================================
// Agent Helper Types & Functions (inlined from SwitchAgentUseCase)
// ============================================================================

interface AgentInfo {
	id: string;
	displayName: string;
}

function getActiveAgentId(plugin: AgentClientPlugin): string {
	const settings = plugin.settings;
	return settings.activeAgentId || settings.claude.id;
}

function getAvailableAgentsFromSettings(plugin: AgentClientPlugin): AgentInfo[] {
	const settings = plugin.settings;
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

function getCurrentAgentInfo(plugin: AgentClientPlugin): AgentInfo {
	const activeId = getActiveAgentId(plugin);
	const agents = getAvailableAgentsFromSettings(plugin);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

/**
 * Get agent settings by ID (inlined from ManageSessionUseCase)
 */
function getAgentSettingsById(
	plugin: AgentClientPlugin,
	agentId: string,
): BaseAgentSettings | null {
	const settings = plugin.settings;
	if (agentId === settings.claude.id) return settings.claude;
	if (agentId === settings.codex.id) return settings.codex;
	if (agentId === settings.gemini.id) return settings.gemini;
	const customAgent = settings.customAgents.find((a) => a.id === agentId);
	return customAgent || null;
}

/**
 * Build agent config with API keys (inlined from ManageSessionUseCase)
 */
function buildAgentConfig(
	plugin: AgentClientPlugin,
	agentId: string,
	agentSettings: BaseAgentSettings,
	workingDirectory: string,
) {
	const settings = plugin.settings;
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);

	// Add API keys to environment for known agents
	if (agentId === settings.claude.id) {
		const claudeSettings = agentSettings as ClaudeAgentSettings;
		return {
			...baseConfig,
			env: { ...baseConfig.env, ANTHROPIC_API_KEY: claudeSettings.apiKey },
		};
	}
	if (agentId === settings.codex.id) {
		const codexSettings = agentSettings as CodexAgentSettings;
		return {
			...baseConfig,
			env: { ...baseConfig.env, OPENAI_API_KEY: codexSettings.apiKey },
		};
	}
	if (agentId === settings.gemini.id) {
		const geminiSettings = agentSettings as GeminiAgentSettings;
		return {
			...baseConfig,
			env: { ...baseConfig.env, GOOGLE_API_KEY: geminiSettings.apiKey },
		};
	}
	return baseConfig;
}

// ============================================================================
// Message Preparation Helper Types & Functions (inlined from SendMessageUseCase)
// ============================================================================

interface PrepareMessageInput {
	message: string;
	activeNote?: NoteMetadata | null;
	vaultBasePath: string;
	isAutoMentionDisabled?: boolean;
	convertToWsl?: boolean;
}

interface PrepareMessageResult {
	displayMessage: string;
	agentMessage: string;
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

interface SendPreparedMessageInput {
	sessionId: string;
	agentMessage: string;
	displayMessage: string;
	authMethods: AuthenticationMethod[];
}

interface SendMessageResult {
	success: boolean;
	displayMessage: string;
	agentMessage: string;
	error?: AgentError;
	requiresAuth?: boolean;
	retriedSuccessfully?: boolean;
}

const MAX_NOTE_LENGTH = 10000;
const MAX_SELECTION_LENGTH = 10000;

/**
 * Check if error is the "empty response text" error that should be ignored
 */
function isEmptyResponseError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	if (!("code" in error) || (error as { code: unknown }).code !== -32603) return false;
	if (!("data" in error)) return false;

	const errorData = (error as { data: unknown }).data;
	if (
		errorData &&
		typeof errorData === "object" &&
		"details" in errorData &&
		typeof (errorData as { details: unknown }).details === "string" &&
		(errorData as { details: string }).details.includes("empty response text")
	) {
		return true;
	}
	return false;
}

/**
 * Build context from auto-mentioned note.
 */
async function buildAutoMentionContext(
	notePath: string,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl?: boolean,
	selection?: { from: EditorPosition; to: EditorPosition },
): Promise<string> {
	let absolutePath = vaultPath ? `${vaultPath}/${notePath}` : notePath;
	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}

	if (selection) {
		const fromLine = selection.from.line + 1;
		const toLine = selection.to.line + 1;

		try {
			const content = await vaultAccess.readNote(notePath);
			const lines = content.split("\n");
			const selectedLines = lines.slice(selection.from.line, selection.to.line + 1);
			let selectedText = selectedLines.join("\n");

			let truncationNote = "";
			if (selectedText.length > MAX_SELECTION_LENGTH) {
				selectedText = selectedText.substring(0, MAX_SELECTION_LENGTH);
				truncationNote = `\n\n[Note: The selection was truncated. Original length: ${selectedLines.join("\n").length} characters, showing first ${MAX_SELECTION_LENGTH} characters]`;
			}

			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">
The user opened the note ${absolutePath} in Obsidian and selected the following text (lines ${fromLine}-${toLine}):

${selectedText}${truncationNote}

This is what the user is currently focusing on.
</obsidian_opened_note>`;
		} catch (error) {
			console.error(`Failed to read selection from ${notePath}:`, error);
			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">The user opened the note ${absolutePath} in Obsidian and is focusing on lines ${fromLine}-${toLine}. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the specific lines.</obsidian_opened_note>`;
		}
	}

	return `<obsidian_opened_note>The user opened the note ${absolutePath} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>`;
}

/**
 * Prepare message with mentions and auto-mention context
 */
async function prepareMessage(
	input: PrepareMessageInput,
	mentionService: IMentionService,
	vaultAccess: IVaultAccess,
): Promise<PrepareMessageResult> {
	const mentionedNotes = extractMentionedNotes(input.message, mentionService);
	const contextBlocks: string[] = [];

	for (const { file } of mentionedNotes) {
		if (!file) continue;

		try {
			const content = await vaultAccess.readNote(file.path);
			let processedContent = content;
			let truncationNote = "";

			if (content.length > MAX_NOTE_LENGTH) {
				processedContent = content.substring(0, MAX_NOTE_LENGTH);
				truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${MAX_NOTE_LENGTH} characters]`;
			}

			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;
			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			const contextBlock = `<obsidian_mentioned_note ref="${absolutePath}">\n${processedContent}${truncationNote}\n</obsidian_mentioned_note>`;
			contextBlocks.push(contextBlock);
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoContext = await buildAutoMentionContext(
			input.activeNote.path,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.activeNote.selection,
		);
		contextBlocks.push(autoContext);
	}

	const agentMessage =
		contextBlocks.length > 0
			? contextBlocks.join("\n") + "\n\n" + input.message
			: input.message;

	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine: input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayMessage: input.message,
		agentMessage,
		autoMentionContext,
	};
}

/**
 * Retry sending message after authentication
 */
async function retryWithAuthentication(
	acpAdapter: AcpAdapter,
	sessionId: string,
	agentMessage: string,
	displayMessage: string,
	authMethodId: string,
): Promise<SendMessageResult | null> {
	try {
		const authSuccess = await acpAdapter.authenticate(authMethodId);
		if (!authSuccess) return null;

		await acpAdapter.sendMessage(sessionId, agentMessage);
		return {
			success: true,
			displayMessage,
			agentMessage,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "communication",
				severity: "error",
				title: "Message Send Failed",
				message: `Failed to send message after authentication: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
				suggestion: "Please try again or check your connection.",
				occurredAt: new Date(),
				sessionId,
				originalError: retryError,
			},
		};
	}
}

/**
 * Handle errors that occur during message sending
 */
async function handleSendError(
	error: unknown,
	acpAdapter: AcpAdapter,
	sessionId: string,
	agentMessage: string,
	displayMessage: string,
	authMethods: AuthenticationMethod[],
): Promise<SendMessageResult> {
	if (isEmptyResponseError(error)) {
		return { success: true, displayMessage, agentMessage };
	}

	const isRateLimitError =
		error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === 429;

	if (isRateLimitError) {
		const errorMessage =
			"message" in error && typeof (error as { message: unknown }).message === "string"
				? (error as { message: string }).message
				: "Too many requests. Please try again later.";

		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "rate_limit",
				severity: "error",
				title: "Rate Limit Exceeded",
				message: `Rate limit exceeded: ${errorMessage}`,
				suggestion: "You have exceeded the API rate limit. Please wait a few moments before trying again.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	if (!authMethods || authMethods.length === 0) {
		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "authentication",
				severity: "error",
				title: "No Authentication Methods",
				message: "No authentication methods available for this agent.",
				suggestion: "Please check your agent configuration in settings.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	if (authMethods.length === 1) {
		const retryResult = await retryWithAuthentication(
			acpAdapter,
			sessionId,
			agentMessage,
			displayMessage,
			authMethods[0].id,
		);
		if (retryResult) return retryResult;
	}

	return {
		success: false,
		displayMessage,
		agentMessage,
		requiresAuth: true,
		error: {
			id: crypto.randomUUID(),
			category: "authentication",
			severity: "error",
			title: "Authentication Required",
			message:
				"Authentication failed. Please check if you are logged into the agent or if your API key is correctly set.",
			suggestion: "Check your agent configuration in settings and ensure API keys are valid.",
			occurredAt: new Date(),
			sessionId,
			originalError: error,
		},
	};
}

/**
 * Send prepared message to agent
 */
async function sendPreparedMessage(
	input: SendPreparedMessageInput,
	acpAdapter: AcpAdapter,
): Promise<SendMessageResult> {
	try {
		await acpAdapter.sendMessage(input.sessionId, input.agentMessage);
		return {
			success: true,
			displayMessage: input.displayMessage,
			agentMessage: input.agentMessage,
		};
	} catch (error) {
		return await handleSendError(
			error,
			acpAdapter,
			input.sessionId,
			input.agentMessage,
			input.displayMessage,
			input.authMethods,
		);
	}
}

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

	const { acpAdapter, vaultAdapter, mentionService } =
		useMemo(() => {
			// Create adapters (all use cases have been inlined)
			const mentionSvc = new NoteMentionService(plugin);
			const vaultAdp = new ObsidianVaultAdapter(plugin);
			const acpAdp = new AcpAdapter(plugin);

			return {
				acpAdapter: acpAdp,
				vaultAdapter: vaultAdp,
				mentionService: mentionSvc,
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
		const activeAgentId = getActiveAgentId(plugin);
		const currentAgent = getCurrentAgentInfo(plugin);

		// Reset UI immediately
		clearMessages();
		sessionHook.resetSession(activeAgentId, currentAgent.displayName);
		setAvailableCommands([]);

		try {
			// Inlined from ManageSessionUseCase.createSession
			const agentSettings = getAgentSettingsById(plugin, activeAgentId);
			if (!agentSettings) {
				sessionHook.setSessionState("error");
				sessionHook.setError({
					title: "Agent Not Found",
					message: `Agent with ID "${activeAgentId}" not found in settings`,
					suggestion: "Please check your agent configuration in settings.",
				});
				return;
			}

			const agentConfig = buildAgentConfig(
				plugin,
				activeAgentId,
				agentSettings,
				workingDirectory,
			);

			// Check if initialization is needed
			const needsInitialize =
				!acpAdapter.isInitialized() ||
				acpAdapter.getCurrentAgentId() !== activeAgentId;

			let authMethods: AuthenticationMethod[] = [];
			if (needsInitialize) {
				const initResult = await acpAdapter.initialize(agentConfig);
				authMethods = initResult.authMethods;
			}

			// Create new session
			const sessionResult = await acpAdapter.newSession(workingDirectory);

			sessionHook.markReady(sessionResult.sessionId, authMethods);
		} catch (error) {
			sessionHook.setSessionState("error");
			sessionHook.setError({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [plugin, acpAdapter, workingDirectory, clearMessages, sessionHook]);

	const cancelCurrentOperation = useCallback(async () => {
		const { session } = sessionHook;
		if (!session.sessionId) return;

		try {
			// Inlined from ManageSessionUseCase.closeSession
			await acpAdapter.cancel(session.sessionId);
			sessionHook.setSending(false);
			sessionHook.setSessionState("ready");
		} catch (error) {
			console.warn("Failed to cancel operation:", error);
			sessionHook.setSending(false);
			sessionHook.setSessionState("ready");
		}
	}, [acpAdapter, sessionHook]);

	const disconnect = useCallback(async () => {
		// Inlined from ManageSessionUseCase
		if (sessionHook.session.sessionId) {
			try {
				await acpAdapter.cancel(sessionHook.session.sessionId);
			} catch (error) {
				console.warn("Failed to close session:", error);
			}
		}
		await acpAdapter.disconnect();
		sessionHook.markDisconnected();
	}, [acpAdapter, sessionHook]);

	/**
	 * Restart session - cancel current and create new.
	 */
	const restartSession = useCallback(async () => {
		const { session } = sessionHook;
		if (session.sessionId) {
			try {
				// Inlined from ManageSessionUseCase.closeSession
				await acpAdapter.cancel(session.sessionId);
			} catch (error) {
				console.warn("Failed to close session during restart:", error);
			}
		}
		await createNewSession();
	}, [acpAdapter, sessionHook, createNewSession]);

	/**
	 * Dispose - cleanup all resources.
	 * Called when the view is being closed.
	 */
	const dispose = useCallback(async () => {
		try {
			// Inlined from ManageSessionUseCase
			const { session } = sessionHook;
			if (session.sessionId) {
				await acpAdapter.cancel(session.sessionId);
			}
			await acpAdapter.disconnect();
		} catch (error) {
			console.warn("Error during dispose:", error);
		}
	}, [acpAdapter, sessionHook]);

	// ========================================
	// Message Actions
	// ========================================

	const sendMessageFn = useCallback(
		async (content: string, sendOptions: SendMessageOptions) => {
			const { session, canSendMessage } = sessionHook;

			if (!canSendMessage || !session.sessionId) {
				return;
			}

			// Phase 1: Prepare message (inlined from SendMessageUseCase)
			const prepared = await prepareMessage(
				{
					message: content,
					activeNote: sendOptions.activeNote,
					vaultBasePath: sendOptions.vaultBasePath,
					isAutoMentionDisabled: sendOptions.isAutoMentionDisabled,
					convertToWsl: plugin.settings.windowsWslMode,
				},
				mentionService,
				vaultAdapter,
			);

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

			// Phase 4: Send to agent (inlined from SendMessageUseCase)
			try {
				const result = await sendPreparedMessage(
					{
						sessionId: session.sessionId,
						agentMessage: prepared.agentMessage,
						displayMessage: prepared.displayMessage,
						authMethods: session.authMethods,
					},
					acpAdapter,
				);

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
			plugin.settings,
			mentionService,
			vaultAdapter,
			acpAdapter,
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
		async (
			requestId: string,
			optionId: string,
		): Promise<{ success: boolean; error?: string }> => {
			try {
				// Inlined from HandlePermissionUseCase - directly call adapter
				await acpAdapter.respondToPermission(requestId, optionId);
				return { success: true };
			} catch (error) {
				const errorMessage = `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`;
				sessionHook.setError({
					title: "Permission Error",
					message: errorMessage,
				});
				return { success: false, error: errorMessage };
			}
		},
		[acpAdapter, sessionHook],
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
			// Update settings directly (inlined from SwitchAgentUseCase)
			await plugin.settingsStore.updateSettings({
				activeAgentId: agentId,
			});
			sessionHook.setSession({
				agentId,
				availableCommands: undefined,
			});
			setAvailableCommands([]);
		},
		[plugin, sessionHook],
	);

	const getAvailableAgents = useCallback(() => {
		return getAvailableAgentsFromSettings(plugin);
	}, [plugin]);

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
		sendMessage: sendMessageFn,
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
	};
}

export type UseChatReturn = ReturnType<typeof useChat>;
