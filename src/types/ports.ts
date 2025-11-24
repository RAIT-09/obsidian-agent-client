/**
 * Port Interfaces
 *
 * Interfaces that define contracts between layers.
 * These ports allow the domain layer to work without
 * depending on specific implementations.
 */

import type {
	ChatMessage,
	AuthenticationMethod,
	PermissionRequest,
} from "./chat";
import type { AgentError, AgentConfig } from "./agent";
import type { NoteMetadata } from "./vault";
import type { PluginSettings } from "./settings";

// ============================================================================
// Agent Client Port
// ============================================================================

/**
 * Result of initializing a connection to an agent.
 */
export interface InitializeResult {
	/** Available authentication methods */
	authMethods: AuthenticationMethod[];

	/** Protocol version supported by the agent (ACP uses number) */
	protocolVersion: number;
}

/**
 * Result of creating a new session.
 */
export interface NewSessionResult {
	/** Unique identifier for the new session */
	sessionId: string;
}

/**
 * Interface for communicating with ACP-compatible agents.
 */
export interface IAgentClient {
	/**
	 * Initialize connection to an agent.
	 */
	initialize(config: AgentConfig): Promise<InitializeResult>;

	/**
	 * Create a new chat session.
	 */
	newSession(workingDirectory: string): Promise<NewSessionResult>;

	/**
	 * Authenticate with the agent.
	 */
	authenticate(methodId: string): Promise<boolean>;

	/**
	 * Send a message to the agent.
	 */
	sendMessage(sessionId: string, message: string): Promise<void>;

	/**
	 * Cancel ongoing agent operations.
	 */
	cancel(sessionId: string): Promise<void>;

	/**
	 * Disconnect from the agent.
	 */
	disconnect(): Promise<void>;

	/**
	 * Register callback for receiving messages from the agent.
	 */
	onMessage(callback: (message: ChatMessage) => void): void;

	/**
	 * Register callback for errors.
	 */
	onError(callback: (error: AgentError) => void): void;

	/**
	 * Register callback for permission requests.
	 */
	onPermissionRequest(callback: (request: PermissionRequest) => void): void;

	/**
	 * Respond to a permission request.
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void>;

	/**
	 * Check if the agent connection is initialized and ready.
	 */
	isInitialized(): boolean;

	/**
	 * Get the ID of the currently connected agent.
	 */
	getCurrentAgentId(): string | null;
}

// ============================================================================
// Vault Access Port
// ============================================================================

/**
 * Interface for accessing vault notes and files.
 */
export interface IVaultAccess {
	/**
	 * Read the content of a note.
	 */
	readNote(path: string): Promise<string>;

	/**
	 * Search for notes matching a query.
	 */
	searchNotes(query: string): Promise<NoteMetadata[]>;

	/**
	 * Get the currently active note in the editor.
	 */
	getActiveNote(): Promise<NoteMetadata | null>;

	/**
	 * List all markdown notes in the vault.
	 */
	listNotes(): Promise<NoteMetadata[]>;
}

// ============================================================================
// Settings Access Port
// ============================================================================

/**
 * Interface for accessing and managing plugin settings.
 */
export interface ISettingsAccess {
	/**
	 * Get the current settings snapshot.
	 */
	getSnapshot(): PluginSettings;

	/**
	 * Update plugin settings.
	 */
	updateSettings(updates: Partial<PluginSettings>): Promise<void>;

	/**
	 * Subscribe to settings changes.
	 */
	subscribe(listener: () => void): () => void;
}
