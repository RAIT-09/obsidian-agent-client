/**
 * ChatBridge Interface
 *
 * Provides a bridge between the ChatView class (Obsidian ItemView)
 * and the React hooks used in ChatComponent.
 *
 * This allows the ChatView class to call methods on the React component
 * without directly depending on hooks.
 */

import type { ChatMessage } from "../../../types";

export interface ChatBridgeState {
	messages: ChatMessage[];
	session: {
		agentId: string;
	};
}

export interface ChatBridge {
	/** Dispose resources on view close */
	dispose: () => Promise<void>;

	/** Approve the currently active permission request */
	approveActivePermission: () => Promise<boolean>;

	/** Reject the currently active permission request */
	rejectActivePermission: () => Promise<boolean>;

	/** Toggle auto-mention mode */
	toggleAutoMention: (disabled: boolean) => void;

	/** Get current auto-mention disabled state */
	getIsAutoMentionDisabled: () => boolean;

	/** Get current state snapshot */
	getSnapshot: () => ChatBridgeState;

	/** Restart session (cancel current and create new) */
	restartSession: () => Promise<void>;
}
