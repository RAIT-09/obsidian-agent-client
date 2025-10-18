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

import type { ChatMessage } from "../domain/models/chat-message";
import type { ChatSession, SessionState } from "../domain/models/chat-session";
import type { ErrorInfo } from "../domain/models/agent-error";
import type { NoteMetadata } from "../ports/vault-access.port";
import type { SendMessageUseCase } from "../use-cases/send-message.use-case";
import type { ManageSessionUseCase } from "../use-cases/manage-session.use-case";
import type { HandlePermissionUseCase } from "../use-cases/handle-permission.use-case";
import type { SwitchAgentUseCase } from "../use-cases/switch-agent.use-case";

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

	/**
	 * Create a new ChatViewModel.
	 *
	 * @param sendMessageUseCase - Use case for sending messages
	 * @param manageSessionUseCase - Use case for session management
	 * @param handlePermissionUseCase - Use case for permission handling
	 * @param switchAgentUseCase - Use case for agent switching
	 * @param workingDirectory - Working directory for the agent
	 */
	constructor(
		sendMessageUseCase: SendMessageUseCase,
		manageSessionUseCase: ManageSessionUseCase,
		handlePermissionUseCase: HandlePermissionUseCase,
		switchAgentUseCase: SwitchAgentUseCase,
		private workingDirectory: string,
	) {
		this.sendMessageUseCase = sendMessageUseCase;
		this.manageSessionUseCase = manageSessionUseCase;
		this.handlePermissionUseCase = handlePermissionUseCase;
		this.switchAgentUseCase = switchAgentUseCase;

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
		// Update state to initializing
		this.setState({
			session: {
				...this.state.session,
				state: "initializing",
			},
		});

		// Use ManageSessionUseCase to create session
		const result = await this.manageSessionUseCase.createSession({
			workingDirectory: this.workingDirectory,
		});

		if (result.success && result.sessionId) {
			// Update session with new ID and ready state
			const activeAgentId = this.switchAgentUseCase.getActiveAgentId();

			this.setState({
				messages: [], // Clear messages for new session
				session: {
					...this.state.session,
					sessionId: result.sessionId,
					state: "ready",
					agentId: activeAgentId,
					createdAt: new Date(),
					lastActivityAt: new Date(),
				},
				errorInfo: null,
			});
		} else {
			// Handle error
			this.setState({
				session: {
					...this.state.session,
					state: "error",
				},
				errorInfo: result.error || {
					title: "Session Creation Failed",
					message: "Failed to create new session",
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
	 * Disconnect from the current session.
	 */
	async disconnect(): Promise<void> {
		if (this.state.session.sessionId) {
			await this.manageSessionUseCase.closeSession(
				this.state.session.sessionId,
			);
		}

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

		// Set sending state
		this.setState({ isSending: true });

		// Add user message immediately (for UI responsiveness)
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: content }],
			timestamp: new Date(),
		};
		this.addMessage(userMessage);

		// Execute SendMessageUseCase
		const result = await this.sendMessageUseCase.execute({
			sessionId: this.state.session.sessionId,
			message: content,
			activeNote: options.activeNote,
			vaultBasePath: options.vaultBasePath,
			isAutoMentionDisabled: options.isAutoMentionDisabled,
			authMethods: this.state.session.authMethods,
		});

		if (result.success) {
			// Update session state to ready
			this.setState({
				isSending: false,
				session: {
					...this.state.session,
					state: "ready",
					lastActivityAt: new Date(),
				},
			});
		} else {
			// Handle error
			this.setState({
				isSending: false,
				errorInfo: result.error || {
					title: "Send Message Failed",
					message: "Failed to send message",
				},
			});
		}
	}

	/**
	 * Add a message to the chat.
	 *
	 * @param message - Message to add
	 */
	private addMessage(message: ChatMessage): void {
		this.setState({
			messages: [...this.state.messages, message],
		});
	}

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
		const result = await this.handlePermissionUseCase.approvePermission({
			requestId,
			optionId,
		});

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
