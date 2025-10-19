/**
 * ChatViewModel
 *
 * Presentation logic layer for the chat interface.
 * Manages application state and orchestrates use cases.
 *
 * Responsibilities:
 * - Manage chat messages and session state
 * - Coordinate use case execution
 * - Provide observable state for React components
 * - Handle connection lifecycle
 * - Manage error state
 */

import type {
	ChatMessage,
	MessageContent,
} from "../../core/domain/models/chat-message";
import type {
	ChatSession,
	SessionState,
} from "../../core/domain/models/chat-session";
import type { ErrorInfo } from "../../core/domain/models/agent-error";
import type { NoteMetadata } from "../../core/domain/ports/vault-access.port";
import type { IVaultAccess } from "../../core/domain/ports/vault-access.port";
import type { SendMessageUseCase } from "../../core/use-cases/send-message.use-case";
import type { ManageSessionUseCase } from "../../core/use-cases/manage-session.use-case";
import type { HandlePermissionUseCase } from "../../core/use-cases/handle-permission.use-case";
import type { SwitchAgentUseCase } from "../../core/use-cases/switch-agent.use-case";
import type AgentClientPlugin from "../../infrastructure/obsidian-plugin/plugin";
import type { MentionContext } from "../../shared/mention-utils";
import { detectMention, replaceMention } from "../../shared/mention-utils";

// ============================================================================
// ViewModel State
// ============================================================================

/**
 * Complete state snapshot for the chat interface.
 *
 * This represents all domain state managed by the ViewModel.
 * UI-specific state (input values, scroll position, etc.) remains in ChatView.
 */
export interface ChatViewModelState {
	/** All messages in the current chat session */
	messages: ChatMessage[];

	/** Current session information and state */
	session: ChatSession;

	/** Current error information (null if no error) */
	errorInfo: ErrorInfo | null;

	/** Whether a message is currently being sent */
	isSending: boolean;

	// Mention dropdown state
	/** Whether the mention dropdown is currently shown */
	showMentionDropdown: boolean;

	/** Note suggestions for mention dropdown */
	mentionSuggestions: NoteMetadata[];

	/** Currently selected index in mention dropdown */
	selectedMentionIndex: number;

	/** Current mention context (query and position) */
	mentionContext: MentionContext | null;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionTemporarilyDisabled: boolean;

	/** Last user message that can be restored after cancel */
	lastUserMessage: string | null;
}

// ============================================================================
// Options and Parameters
// ============================================================================

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;

	/** Vault base path for mention resolution */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
}

// ============================================================================
// ChatViewModel Implementation
// ============================================================================

/**
 * ViewModel for the chat interface.
 *
 * Manages domain state and coordinates use cases.
 * Implements observer pattern for React integration via useSyncExternalStore.
 */
export class ChatViewModel {
	// ========================================
	// State Management
	// ========================================

	/** Current state snapshot */
	private state: ChatViewModelState;

	/** Registered listeners for state changes */
	private listeners = new Set<() => void>();

	// ========================================
	// Dependencies (Use Cases)
	// ========================================

	private sendMessageUseCase: SendMessageUseCase;
	private manageSessionUseCase: ManageSessionUseCase;
	private handlePermissionUseCase: HandlePermissionUseCase;
	private switchAgentUseCase: SwitchAgentUseCase;

	// ========================================
	// Other Dependencies
	// ========================================

	/** Plugin instance for logger and settings */
	private plugin: AgentClientPlugin;

	/** Vault access for note search (mention functionality) */
	private vaultAccess: IVaultAccess;

	/**
	 * Create a new ChatViewModel.
	 *
	 * @param plugin - Plugin instance
	 * @param sendMessageUseCase - Use case for sending messages
	 * @param manageSessionUseCase - Use case for session management
	 * @param handlePermissionUseCase - Use case for permission handling
	 * @param switchAgentUseCase - Use case for agent switching
	 * @param vaultAccess - Vault access port for note searching (mention functionality)
	 * @param workingDirectory - Working directory for the agent
	 */
	constructor(
		plugin: AgentClientPlugin,
		sendMessageUseCase: SendMessageUseCase,
		manageSessionUseCase: ManageSessionUseCase,
		handlePermissionUseCase: HandlePermissionUseCase,
		switchAgentUseCase: SwitchAgentUseCase,
		vaultAccess: IVaultAccess,
		private workingDirectory: string,
	) {
		this.plugin = plugin;
		this.sendMessageUseCase = sendMessageUseCase;
		this.manageSessionUseCase = manageSessionUseCase;
		this.handlePermissionUseCase = handlePermissionUseCase;
		this.switchAgentUseCase = switchAgentUseCase;
		this.vaultAccess = vaultAccess;

		// Initialize state
		this.state = this.createInitialState();
	}

	// ========================================
	// Observer Pattern (React Integration)
	// ========================================

	/**
	 * Get current state snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 *
	 * @returns Current ViewModel state
	 */
	getSnapshot = (): ChatViewModelState => this.state;

	/**
	 * Subscribe to state changes.
	 *
	 * Used by React's useSyncExternalStore to re-render on changes.
	 *
	 * @param listener - Callback to invoke when state changes
	 * @returns Unsubscribe function
	 */
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/**
	 * Notify all listeners that state has changed.
	 *
	 * Triggers React re-renders for components using this ViewModel.
	 */
	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	/**
	 * Update state and notify listeners.
	 *
	 * @param updates - Partial state to merge with current state
	 */
	private setState(updates: Partial<ChatViewModelState>): void {
		this.state = { ...this.state, ...updates };
		this.notifyListeners();
	}

	// ========================================
	// State Initialization
	// ========================================

	/**
	 * Create initial ViewModel state.
	 *
	 * @returns Initial state with empty messages and disconnected session
	 */
	private createInitialState(): ChatViewModelState {
		const activeAgentId = this.switchAgentUseCase.getActiveAgentId();

		return {
			messages: [],
			session: {
				sessionId: null,
				state: "disconnected" as SessionState,
				agentId: activeAgentId,
				authMethods: [],
				createdAt: new Date(),
				lastActivityAt: new Date(),
				workingDirectory: this.workingDirectory,
			},
			errorInfo: null,
			isSending: false,
			// Mention dropdown state
			showMentionDropdown: false,
			mentionSuggestions: [],
			selectedMentionIndex: 0,
			mentionContext: null,
			isAutoMentionTemporarilyDisabled: false,
			lastUserMessage: null,
		};
	}

	// ========================================
	// Computed Properties
	// ========================================

	/**
	 * Check if the session is ready to send messages.
	 *
	 * @returns True if session is ready and not sending
	 */
	get isReady(): boolean {
		return this.state.session.state === "ready" && !this.state.isSending;
	}

	/**
	 * Check if a message can be sent.
	 *
	 * @returns True if session has an ID and is ready
	 */
	get canSendMessage(): boolean {
		return (
			this.state.session.sessionId !== null &&
			this.state.session.state === "ready"
		);
	}

	// ========================================
	// Actions: Session Management
	// ========================================

	/**
	 * Create a new chat session.
	 *
	 * Initializes connection to the active agent and prepares for messaging.
	 */
	async createNewSession(): Promise<void> {
		// Get active agent ID before async operations
		const activeAgentId = this.switchAgentUseCase.getActiveAgentId();

		// Reset UI immediately (synchronous) - same as plugin startup flow
		this.setState({
			messages: [], // Clear messages immediately
			session: {
				...this.state.session,
				agentId: activeAgentId,
				state: "initializing",
				sessionId: null,
				authMethods: [],
				createdAt: new Date(),
				lastActivityAt: new Date(),
			},
			errorInfo: null,
		});

		try {
			// Background: initialize + newSession
			const result = await this.manageSessionUseCase.createSession({
				workingDirectory: this.workingDirectory,
				agentId: activeAgentId,
			});

			if (result.success && result.sessionId) {
				// Update with session ID and ready state
				this.setState({
					session: {
						...this.state.session,
						sessionId: result.sessionId,
						state: "ready",
						authMethods: result.authMethods || [],
						lastActivityAt: new Date(),
					},
				});
			} else {
				// Handle Use Case error
				this.setState({
					session: {
						...this.state.session,
						state: "error",
					},
					errorInfo: result.error || {
						title: "Session Creation Failed",
						message: "Failed to create new session",
						suggestion: "Please try again.",
					},
				});
			}
		} catch (error) {
			// Handle unexpected error
			this.setState({
				session: {
					...this.state.session,
					state: "error",
				},
				errorInfo: {
					title: "Session Creation Failed",
					message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion:
						"Please check the agent configuration and try again.",
				},
			});
		}
	}

	/**
	 * Restart the current session.
	 *
	 * Closes the current session and creates a new one.
	 */
	async restartSession(): Promise<void> {
		await this.createNewSession();
	}

	/**
	 * Cancel the current agent operation.
	 *
	 * Stops any ongoing message generation without disconnecting the session.
	 */
	async cancelCurrentOperation(): Promise<void> {
		if (!this.state.session.sessionId) {
			return;
		}

		try {
			// Cancel via Use Case
			await this.manageSessionUseCase.closeSession(
				this.state.session.sessionId,
			);

			// Update state to ready (session still connected, just stopped)
			this.setState({
				isSending: false,
				session: {
					...this.state.session,
					state: "ready",
				},
			});
		} catch (error) {
			// If cancel fails, log but don't crash
			console.warn("Failed to cancel operation:", error);

			// Still update UI to ready state
			this.setState({
				isSending: false,
				session: {
					...this.state.session,
					state: "ready",
				},
			});
		}
	}

	/**
	 * Disconnect from the current session.
	 */
	async disconnect(): Promise<void> {
		// Close session via Use Case
		await this.manageSessionUseCase.closeSession(
			this.state.session.sessionId,
		);

		this.setState({
			session: {
				...this.state.session,
				sessionId: null,
				state: "disconnected",
			},
		});
	}

	// ========================================
	// Actions: Message Operations
	// ========================================

	/**
	 * Send a message to the agent.
	 *
	 * @param content - Message content to send
	 * @param options - Options for message sending
	 */
	async sendMessage(
		content: string,
		options: SendMessageOptions,
	): Promise<void> {
		if (!this.canSendMessage || !this.state.session.sessionId) {
			return;
		}

		// Phase 1: Prepare message (synchronous)
		const prepared = this.sendMessageUseCase.prepareMessage({
			message: content,
			activeNote: options.activeNote,
			vaultBasePath: options.vaultBasePath,
			isAutoMentionDisabled: options.isAutoMentionDisabled,
		});

		// Phase 2: Add user message to UI immediately
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [
				{
					type: "text",
					text: prepared.displayMessage,
				},
			],
			timestamp: new Date(),
		};
		this.addMessage(userMessage);

		// Phase 3: Set sending state and store original message for potential restore
		this.setState({
			isSending: true,
			session: {
				...this.state.session,
				state: "busy",
			},
			lastUserMessage: content, // Store original message before preparation
		});

		// Phase 4: Send prepared message to agent (asynchronous)
		try {
			const result = await this.sendMessageUseCase.sendPreparedMessage({
				sessionId: this.state.session.sessionId,
				agentMessage: prepared.agentMessage,
				displayMessage: prepared.displayMessage,
				authMethods: this.state.session.authMethods,
			});

			if (result.success) {
				// Update session state to ready and clear stored message
				this.setState({
					isSending: false,
					session: {
						...this.state.session,
						state: "ready",
						lastActivityAt: new Date(),
					},
					lastUserMessage: null, // Clear on success
				});
			} else {
				// Handle error from use case
				this.setState({
					isSending: false,
					session: {
						...this.state.session,
						state: "ready",
					},
					errorInfo: result.error || {
						title: "Send Message Failed",
						message: "Failed to send message",
					},
				});
			}
		} catch (error) {
			// Handle unexpected error
			this.setState({
				isSending: false,
				session: {
					...this.state.session,
					state: "ready",
				},
				errorInfo: {
					title: "Send Message Failed",
					message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				},
			});
		}
	}

	/**
	 * Add a message to the chat.
	 *
	 * Used by AcpAdapter callback and internal methods.
	 *
	 * @param message - Message to add
	 */
	addMessage = (message: ChatMessage): void => {
		this.setState({
			messages: [...this.state.messages, message],
		});
	};

	/**
	 * Update the last message in the chat.
	 *
	 * Used by AcpAdapter callback for streaming updates.
	 *
	 * @param content - New content for the last message
	 */
	updateLastMessage = (content: MessageContent): void => {
		// If no messages or last message is not assistant, create new assistant message
		if (
			this.state.messages.length === 0 ||
			this.state.messages[this.state.messages.length - 1].role !==
				"assistant"
		) {
			const newMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "assistant",
				content: [content],
				timestamp: new Date(),
			};
			this.setState({
				messages: [...this.state.messages, newMessage],
			});
			return;
		}

		const lastMessage = this.state.messages[this.state.messages.length - 1];
		const updatedMessage = { ...lastMessage };

		if (content.type === "text" || content.type === "agent_thought") {
			// Append to existing content of same type or create new content
			const existingContentIndex = updatedMessage.content.findIndex(
				(c) => c.type === content.type,
			);
			if (existingContentIndex >= 0) {
				const existingContent =
					updatedMessage.content[existingContentIndex];
				// Type guard: we know it's text or agent_thought from findIndex condition
				if (
					existingContent.type === "text" ||
					existingContent.type === "agent_thought"
				) {
					updatedMessage.content[existingContentIndex] = {
						type: content.type,
						text:
							existingContent.text +
							(content.type === "agent_thought" ? "\n" : "") +
							content.text,
					};
				}
			} else {
				updatedMessage.content.push(content);
			}
		} else {
			// Replace or add non-text content
			const existingIndex = updatedMessage.content.findIndex(
				(c) => c.type === content.type,
			);

			if (existingIndex >= 0) {
				updatedMessage.content[existingIndex] = content;
			} else {
				updatedMessage.content.push(content);
			}
		}

		this.setState({
			messages: [...this.state.messages.slice(0, -1), updatedMessage],
		});
	};

	/**
	 * Update a specific message by tool call ID.
	 *
	 * Used by AcpAdapter callback for tool call updates.
	 *
	 * @param toolCallId - ID of the tool call to update
	 * @param content - New content for the tool call
	 * @returns True if message was found and updated
	 */
	updateMessage = (toolCallId: string, content: MessageContent): boolean => {
		let found = false;

		const updatedMessages = this.state.messages.map((message) => ({
			...message,
			content: message.content.map((c) => {
				if (
					c.type === "tool_call" &&
					c.toolCallId === toolCallId &&
					content.type === "tool_call"
				) {
					found = true;
					// Merge content arrays
					let mergedContent = c.content || [];
					if (content.content !== undefined) {
						const newContent = content.content || [];

						// If new content contains diff, replace all old diffs
						const hasDiff = newContent.some(
							(item) => item.type === "diff",
						);
						if (hasDiff) {
							mergedContent = mergedContent.filter(
								(item) => item.type !== "diff",
							);
						}

						mergedContent = [...mergedContent, ...newContent];
					}

					return {
						...c,
						toolCallId: content.toolCallId,
						title:
							content.title !== undefined
								? content.title
								: c.title,
						kind:
							content.kind !== undefined ? content.kind : c.kind,
						status:
							content.status !== undefined
								? content.status
								: c.status,
						content: mergedContent,
						permissionRequest:
							content.permissionRequest !== undefined
								? content.permissionRequest
								: c.permissionRequest,
					};
				}
				return c;
			}),
		}));

		if (found) {
			this.setState({
				messages: updatedMessages,
			});
		}

		return found;
	};

	/**
	 * Clear the current error.
	 */
	clearError(): void {
		this.setState({ errorInfo: null });
	}

	// ========================================
	// Actions: Permission Handling
	// ========================================

	/**
	 * Approve a permission request.
	 *
	 * @param requestId - ID of the permission request
	 * @param optionId - ID of the selected option
	 */
	async approvePermission(
		requestId: string,
		optionId: string,
	): Promise<void> {
		try {
			// Use HandlePermissionUseCase to respond to permission
			const result = await this.handlePermissionUseCase.approvePermission(
				{
					requestId,
					optionId,
				},
			);

			if (!result.success) {
				this.setState({
					errorInfo: {
						title: "Permission Error",
						message:
							result.error ||
							"Failed to respond to permission request",
					},
				});
			}
		} catch (error) {
			this.setState({
				errorInfo: {
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				},
			});
		}
	}

	// ========================================
	// Actions: Agent Management
	// ========================================

	/**
	 * Switch to a different agent.
	 *
	 * @param agentId - ID of the agent to switch to
	 */
	async switchAgent(agentId: string): Promise<void> {
		await this.switchAgentUseCase.switchAgent(agentId);

		// Update session with new agent ID
		this.setState({
			session: {
				...this.state.session,
				agentId,
			},
		});
	}

	/**
	 * Get list of available agents.
	 *
	 * @returns Array of agent information
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return this.switchAgentUseCase.getAvailableAgents();
	}

	// ========================================
	// Actions: Mention Management
	// ========================================

	/**
	 * Update mention suggestions based on current input.
	 *
	 * @param input - Current input text
	 * @param cursorPosition - Current cursor position in the input
	 */
	async updateMentionSuggestions(
		input: string,
		cursorPosition: number,
	): Promise<void> {
		// Detect mention context
		const context = detectMention(input, cursorPosition, this.plugin);

		if (!context) {
			// No mention context - close dropdown
			this.setState({
				showMentionDropdown: false,
				mentionSuggestions: [],
				selectedMentionIndex: 0,
				mentionContext: null,
			});
			return;
		}

		// Search for matching notes
		const suggestions = await this.vaultAccess.searchNotes(context.query);

		// Update state with suggestions
		this.setState({
			showMentionDropdown: true,
			mentionSuggestions: suggestions,
			selectedMentionIndex: 0,
			mentionContext: context,
		});
	}

	/**
	 * Select a mention from the suggestion list.
	 *
	 * @param input - Current input text
	 * @param suggestion - Selected note metadata
	 * @returns Updated input text with mention replaced
	 */
	selectMention(input: string, suggestion: NoteMetadata): string {
		if (!this.state.mentionContext) {
			return input;
		}

		// Replace mention with selected note name (without extension)
		const { newText } = replaceMention(
			input,
			this.state.mentionContext,
			suggestion.name,
		);

		// Close dropdown
		this.setState({
			showMentionDropdown: false,
			mentionSuggestions: [],
			selectedMentionIndex: 0,
			mentionContext: null,
		});

		return newText;
	}

	/**
	 * Close the mention dropdown.
	 */
	closeMentionDropdown(): void {
		this.setState({
			showMentionDropdown: false,
			mentionSuggestions: [],
			selectedMentionIndex: 0,
			mentionContext: null,
		});
	}

	/**
	 * Navigate mention dropdown selection.
	 *
	 * @param direction - 'up' or 'down'
	 */
	navigateMentionDropdown(direction: "up" | "down"): void {
		if (!this.state.showMentionDropdown) {
			return;
		}

		const maxIndex = this.state.mentionSuggestions.length - 1;
		let newIndex = this.state.selectedMentionIndex;

		if (direction === "down") {
			newIndex = Math.min(newIndex + 1, maxIndex);
		} else {
			newIndex = Math.max(newIndex - 1, 0);
		}

		this.setState({
			selectedMentionIndex: newIndex,
		});
	}

	/**
	 * Toggle auto-mention mode temporarily.
	 *
	 * @param disabled - Whether auto-mention should be disabled
	 */
	toggleAutoMention(disabled: boolean): void {
		this.setState({
			isAutoMentionTemporarilyDisabled: disabled,
		});
	}

	// ========================================
	// Cleanup
	// ========================================

	/**
	 * Cleanup resources when ViewModel is destroyed.
	 */
	async dispose(): Promise<void> {
		await this.disconnect();
		this.listeners.clear();
	}
}
