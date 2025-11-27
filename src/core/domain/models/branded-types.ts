/**
 * Branded Types for Type-Safe Identifiers
 *
 * Branded types (also known as nominal types or opaque types) provide compile-time
 * distinction between different ID types that would otherwise be indistinguishable
 * strings. This prevents accidental mixing of IDs (e.g., passing a MessageId where
 * a SessionId is expected).
 *
 * Usage:
 *   const msgId = "123" as MessageId;
 *   const sessId = "456" as SessionId;
 *   // TypeScript will error if you try to use msgId where SessionId is expected
 */

// ============================================================================
// Brand Infrastructure
// ============================================================================

/** Unique symbol for branding - ensures brands are unique */
declare const __brand: unique symbol;

/**
 * Brand utility type.
 * Creates a nominal type by adding a unique brand property to a base type.
 */
type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ============================================================================
// ID Types
// ============================================================================

/**
 * Unique identifier for a chat message.
 * Used to track and update individual messages in a conversation.
 */
export type MessageId = Brand<string, "MessageId">;

/**
 * Unique identifier for a chat session.
 * Used to correlate messages and operations within a single session.
 */
export type SessionId = Brand<string, "SessionId">;

/**
 * Unique identifier for a tool call operation.
 * Used to track tool execution status and results.
 */
export type ToolCallId = Brand<string, "ToolCallId">;

/**
 * Unique identifier for a permission request.
 * Used to match permission responses to their requests.
 */
export type RequestId = Brand<string, "RequestId">;

/**
 * Unique identifier for an agent configuration.
 * Used to distinguish between different agent types (claude, gemini, custom).
 */
export type AgentId = Brand<string, "AgentId">;

/**
 * Unique identifier for an error occurrence.
 * Used for error tracking and debugging.
 */
export type ErrorId = Brand<string, "ErrorId">;

/**
 * Unique identifier for a terminal session.
 * Used to track terminal output and lifecycle.
 */
export type TerminalId = Brand<string, "TerminalId">;

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Creates a MessageId from a string.
 * Use when creating new message IDs.
 */
export function createMessageId(id: string): MessageId {
	return id as MessageId;
}

/**
 * Creates a SessionId from a string.
 * Use when creating new session IDs.
 */
export function createSessionId(id: string): SessionId {
	return id as SessionId;
}

/**
 * Creates a ToolCallId from a string.
 * Use when creating new tool call IDs.
 */
export function createToolCallId(id: string): ToolCallId {
	return id as ToolCallId;
}

/**
 * Creates a RequestId from a string.
 * Use when creating new request IDs.
 */
export function createRequestId(id: string): RequestId {
	return id as RequestId;
}

/**
 * Creates an AgentId from a string.
 * Use when creating new agent IDs.
 */
export function createAgentId(id: string): AgentId {
	return id as AgentId;
}

/**
 * Creates an ErrorId from a string.
 * Use when creating new error IDs.
 */
export function createErrorId(id: string): ErrorId {
	return id as ErrorId;
}

/**
 * Creates a TerminalId from a string.
 * Use when creating new terminal IDs.
 */
export function createTerminalId(id: string): TerminalId {
	return id as TerminalId;
}
