import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "../../src/hooks/useChat";
import type { IAgentClient } from "../../src/domain/ports/agent-client.port";
import type { IVaultAccess } from "../../src/domain/ports/vault-access.port";
import type { IMentionService } from "../../src/shared/mention-utils";
import type { SessionContext, SettingsContext } from "../../src/hooks/useChat";
import type { ChatMessage } from "../../src/domain/models/chat-message";

/**
 * Tests for User Story 1.3: Switch Between Tabs - useChat
 *
 * Tests the new restoreIsSending() method and message isolation between tabs.
 *
 * Acceptance Criteria:
 * - Switching tabs shows correct messages for that tab
 * - Input text typed in tab A is not visible when switching to tab B
 * - restoreIsSending correctly restores the sending state
 */

// ============================================================================
// Mock Factories
// ============================================================================

function createMockAgentClient(): IAgentClient {
	return {
		initialize: vi.fn(),
		newSession: vi.fn(),
		authenticate: vi.fn(),
		sendPrompt: vi.fn(),
		cancel: vi.fn(),
		disconnect: vi.fn(),
		onSessionUpdate: vi.fn(),
		onError: vi.fn(),
		respondToPermission: vi.fn(),
		isInitialized: vi.fn().mockReturnValue(true),
		getCurrentAgentId: vi.fn().mockReturnValue("claude-code-acp"),
		setSessionMode: vi.fn(),
		setSessionModel: vi.fn(),
		listSessions: vi.fn(),
		loadSession: vi.fn(),
		resumeSession: vi.fn(),
		forkSession: vi.fn(),
	};
}

function createMockVaultAccess(): IVaultAccess {
	return {
		readNote: vi.fn(),
		searchNotes: vi.fn().mockResolvedValue([]),
		getActiveNote: vi.fn().mockResolvedValue(null),
		listNotes: vi.fn().mockResolvedValue([]),
	};
}

function createMockMentionService(): IMentionService {
	return {
		getAllFiles: vi.fn().mockReturnValue([]),
	};
}

function createSessionContext(overrides?: Partial<SessionContext>): SessionContext {
	return {
		sessionId: "session-1",
		authMethods: [],
		...overrides,
	};
}

function createSettingsContext(overrides?: Partial<SettingsContext>): SettingsContext {
	return {
		windowsWslMode: false,
		maxNoteLength: 10000,
		maxSelectionLength: 5000,
		...overrides,
	};
}

function createMockMessage(overrides?: Partial<ChatMessage>): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{ type: "text", text: "test message" }],
		timestamp: new Date(),
		...overrides,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("useChat - User Story 1.3: Tab State Restoration", () => {
	let mockAgentClient: IAgentClient;
	let mockVaultAccess: IVaultAccess;
	let mockMentionService: IMentionService;
	let sessionContext: SessionContext;
	let settingsContext: SettingsContext;

	beforeEach(() => {
		mockAgentClient = createMockAgentClient();
		mockVaultAccess = createMockVaultAccess();
		mockMentionService = createMockMentionService();
		sessionContext = createSessionContext();
		settingsContext = createSettingsContext();
	});

	// ========================================================================
	// AC: restoreIsSending correctly restores sending state
	// ========================================================================
	describe("restoreIsSending", () => {
		it("should set isSending to true when restoring active sending state", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Initially false
			expect(result.current.isSending).toBe(false);

			// Restore to true (simulating switching to a tab that was sending)
			act(() => {
				result.current.restoreIsSending(true);
			});

			expect(result.current.isSending).toBe(true);
		});

		it("should set isSending to false when restoring idle state", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Set to true first
			act(() => {
				result.current.restoreIsSending(true);
			});
			expect(result.current.isSending).toBe(true);

			// Restore to false
			act(() => {
				result.current.restoreIsSending(false);
			});
			expect(result.current.isSending).toBe(false);
		});
	});

	// ========================================================================
	// AC: Switching tabs shows correct messages for that tab
	// (Test via setMessagesFromLocal which is used by restoreTabState)
	// ========================================================================
	describe("setMessagesFromLocal (used in tab restore)", () => {
		it("should replace all messages with the provided array", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Add some initial messages
			act(() => {
				result.current.addMessage(createMockMessage({ id: "msg-1" }));
				result.current.addMessage(createMockMessage({ id: "msg-2" }));
			});
			expect(result.current.messages).toHaveLength(2);

			// Restore with a different set of messages (simulating tab switch)
			const tabBMessages: ChatMessage[] = [
				createMockMessage({
					id: "tab-b-msg-1",
					content: [{ type: "text", text: "tab B message" }],
				}),
			];

			act(() => {
				result.current.setMessagesFromLocal(tabBMessages);
			});

			expect(result.current.messages).toHaveLength(1);
			expect(result.current.messages[0].id).toBe("tab-b-msg-1");
			expect(result.current.messages[0].content[0]).toEqual({
				type: "text",
				text: "tab B message",
			});
		});

		it("should restore empty messages array for a new tab", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Add messages
			act(() => {
				result.current.addMessage(createMockMessage());
			});
			expect(result.current.messages).toHaveLength(1);

			// Restore empty (new tab)
			act(() => {
				result.current.setMessagesFromLocal([]);
			});

			expect(result.current.messages).toHaveLength(0);
		});

		it("should reset isSending to false when restoring messages", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Simulate sending state
			act(() => {
				result.current.restoreIsSending(true);
			});
			expect(result.current.isSending).toBe(true);

			// setMessagesFromLocal resets isSending to false
			act(() => {
				result.current.setMessagesFromLocal([]);
			});

			expect(result.current.isSending).toBe(false);
		});
	});

	// ========================================================================
	// AC: Tab A messages are preserved when switching to tab B
	// (Test that addMessage, clearMessages are independent operations)
	// ========================================================================
	describe("Message independence for tab switching", () => {
		it("should clear all messages when clearMessages is called", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Add messages for Tab A
			act(() => {
				result.current.addMessage(
					createMockMessage({
						id: "msg-1",
						content: [{ type: "text", text: "Tab A message 1" }],
					}),
				);
				result.current.addMessage(
					createMockMessage({
						id: "msg-2",
						content: [{ type: "text", text: "Tab A message 2" }],
					}),
				);
			});

			expect(result.current.messages).toHaveLength(2);

			// clearMessages resets (used when switching to a new tab)
			act(() => {
				result.current.clearMessages();
			});

			expect(result.current.messages).toHaveLength(0);
			expect(result.current.isSending).toBe(false);
		});

		it("should restore messages independently after clear", () => {
			const { result } = renderHook(() =>
				useChat(
					mockAgentClient,
					mockVaultAccess,
					mockMentionService,
					sessionContext,
					settingsContext,
				),
			);

			// Original messages (Tab A)
			const tabAMessages: ChatMessage[] = [
				createMockMessage({
					id: "tab-a-1",
					content: [{ type: "text", text: "Hello from Tab A" }],
				}),
			];

			// Tab B messages
			const tabBMessages: ChatMessage[] = [
				createMockMessage({
					id: "tab-b-1",
					content: [{ type: "text", text: "Hello from Tab B" }],
				}),
				createMockMessage({
					id: "tab-b-2",
					role: "assistant",
					content: [{ type: "text", text: "Response in Tab B" }],
				}),
			];

			// Load Tab A messages
			act(() => {
				result.current.setMessagesFromLocal(tabAMessages);
			});
			expect(result.current.messages).toHaveLength(1);
			expect(result.current.messages[0].id).toBe("tab-a-1");

			// Switch to Tab B (load Tab B messages)
			act(() => {
				result.current.setMessagesFromLocal(tabBMessages);
			});
			expect(result.current.messages).toHaveLength(2);
			expect(result.current.messages[0].id).toBe("tab-b-1");
			expect(result.current.messages[1].id).toBe("tab-b-2");

			// Switch back to Tab A (restore Tab A messages)
			act(() => {
				result.current.setMessagesFromLocal(tabAMessages);
			});
			expect(result.current.messages).toHaveLength(1);
			expect(result.current.messages[0].id).toBe("tab-a-1");
		});
	});
});
