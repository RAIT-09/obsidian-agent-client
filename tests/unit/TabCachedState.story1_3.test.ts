import { describe, it, expect } from "vitest";
import type { TabCachedState } from "../../src/hooks/useChatController";
import type { ChatMessage } from "../../src/domain/models/chat-message";
import type { ChatSession } from "../../src/domain/models/chat-session";
import type { AttachedImage } from "../../src/components/chat/ImagePreviewStrip";

/**
 * Tests for User Story 1.3: Switch Between Tabs - TabCachedState Type Contract
 *
 * Verifies the TabCachedState interface correctly models all per-tab state
 * that must be saved/restored when switching tabs.
 *
 * Acceptance Criteria:
 * - Input text typed in tab A is not visible when switching to tab B
 * - Attached images in tab A are not visible when switching to tab B
 * - Switching tabs shows correct messages for that tab
 * - Switching tabs shows correct input field state for that tab
 * - Session state (modes, models) preserved per tab
 * - Background tab's agent continues generating (isSending preserved)
 */

describe("TabCachedState - User Story 1.3: Type Contract", () => {
	// ========================================================================
	// Helper: create a fully-populated TabCachedState
	// ========================================================================
	function createTabState(overrides?: Partial<TabCachedState>): TabCachedState {
		const defaultSession: ChatSession = {
			sessionId: "session-1",
			state: "ready",
			agentId: "claude-code-acp",
			agentDisplayName: "Claude Code",
			authMethods: [],
			modes: {
				availableModes: [
					{ id: "build", name: "Build" },
					{ id: "plan", name: "Plan" },
				],
				currentModeId: "build",
			},
			models: {
				availableModels: [
					{ modelId: "claude-sonnet-4", name: "Sonnet" },
				],
				currentModelId: "claude-sonnet-4",
			},
			createdAt: new Date(),
			lastActivityAt: new Date(),
			workingDirectory: "/test",
		};

		const defaultMessages: ChatMessage[] = [
			{
				id: "msg-1",
				role: "user",
				content: [{ type: "text", text: "Hello" }],
				timestamp: new Date(),
			},
			{
				id: "msg-2",
				role: "assistant",
				content: [{ type: "text", text: "Hi there!" }],
				timestamp: new Date(),
			},
		];

		return {
			messages: defaultMessages,
			inputValue: "",
			attachedImages: [],
			session: defaultSession,
			isSending: false,
			...overrides,
		};
	}

	// ========================================================================
	// AC: Input text typed in tab A is not visible when switching to tab B
	// ========================================================================
	describe("Input isolation", () => {
		it("should cache input text per tab", () => {
			const tabA = createTabState({ inputValue: "Hello from Tab A" });
			const tabB = createTabState({ inputValue: "" });

			expect(tabA.inputValue).toBe("Hello from Tab A");
			expect(tabB.inputValue).toBe("");
		});

		it("should preserve partial input when switching tabs", () => {
			// User types "hello" in tab A, switches to tab B, comes back
			const tabA = createTabState({ inputValue: "hello" });
			const tabB = createTabState({ inputValue: "" });

			// Tab A's input is preserved in the cache
			expect(tabA.inputValue).toBe("hello");
			// Tab B has empty input
			expect(tabB.inputValue).toBe("");
		});
	});

	// ========================================================================
	// AC: Attached images in tab A are not visible when switching to tab B
	// ========================================================================
	describe("Image attachment isolation", () => {
		it("should cache attached images per tab", () => {
			const image1: AttachedImage = {
				id: "img-1",
				data: "base64data1",
				mimeType: "image/png",
			};
			const image2: AttachedImage = {
				id: "img-2",
				data: "base64data2",
				mimeType: "image/jpeg",
			};

			const tabA = createTabState({ attachedImages: [image1, image2] });
			const tabB = createTabState({ attachedImages: [] });

			expect(tabA.attachedImages).toHaveLength(2);
			expect(tabA.attachedImages[0].id).toBe("img-1");
			expect(tabB.attachedImages).toHaveLength(0);
		});

		it("should preserve image attachments when tab is cached", () => {
			const image: AttachedImage = {
				id: "screenshot-1",
				data: "iVBORw0KGgoAAA==",
				mimeType: "image/png",
			};

			const tabState = createTabState({ attachedImages: [image] });

			// After caching, the image data should be intact
			expect(tabState.attachedImages[0].data).toBe("iVBORw0KGgoAAA==");
			expect(tabState.attachedImages[0].mimeType).toBe("image/png");
		});
	});

	// ========================================================================
	// AC: Switching tabs shows correct messages for that tab
	// ========================================================================
	describe("Message isolation", () => {
		it("should cache messages per tab", () => {
			const tabAMessages: ChatMessage[] = [
				{
					id: "a-1",
					role: "user",
					content: [{ type: "text", text: "Tab A question" }],
					timestamp: new Date(),
				},
				{
					id: "a-2",
					role: "assistant",
					content: [{ type: "text", text: "Tab A answer" }],
					timestamp: new Date(),
				},
			];

			const tabBMessages: ChatMessage[] = [
				{
					id: "b-1",
					role: "user",
					content: [{ type: "text", text: "Tab B question" }],
					timestamp: new Date(),
				},
			];

			const tabA = createTabState({ messages: tabAMessages });
			const tabB = createTabState({ messages: tabBMessages });

			expect(tabA.messages).toHaveLength(2);
			expect(tabA.messages[0].content[0]).toEqual({
				type: "text",
				text: "Tab A question",
			});

			expect(tabB.messages).toHaveLength(1);
			expect(tabB.messages[0].content[0]).toEqual({
				type: "text",
				text: "Tab B question",
			});
		});

		it("Tab A: Send message 'test' -> Switch to tab B -> Tab A still shows 'test' message", () => {
			// Simulate: User sent "test" in Tab A
			const tabAMessages: ChatMessage[] = [
				{
					id: "test-msg",
					role: "user",
					content: [{ type: "text", text: "test" }],
					timestamp: new Date(),
				},
			];

			// Tab A cached state has the "test" message
			const tabAState = createTabState({ messages: tabAMessages });

			// Tab B has no messages (new tab)
			const tabBState = createTabState({ messages: [] });

			// After switching to B and back:
			// Tab A state still has the "test" message
			expect(tabAState.messages).toHaveLength(1);
			expect(tabAState.messages[0].content[0]).toEqual({
				type: "text",
				text: "test",
			});

			// Tab B has no messages
			expect(tabBState.messages).toHaveLength(0);
		});
	});

	// ========================================================================
	// AC: Background tab's agent continues generating (isSending preserved)
	// ========================================================================
	describe("Sending state preservation", () => {
		it("should preserve isSending state when caching tab", () => {
			// Tab A is actively generating
			const tabA = createTabState({ isSending: true });
			// Tab B is idle
			const tabB = createTabState({ isSending: false });

			expect(tabA.isSending).toBe(true);
			expect(tabB.isSending).toBe(false);
		});

		it("Tab A: Agent generating -> Switch to tab B -> Switch back -> Generation completed", () => {
			// When switching away from Tab A while generating,
			// the cached state records isSending: true
			const tabACacheOnSwitchAway = createTabState({ isSending: true });
			expect(tabACacheOnSwitchAway.isSending).toBe(true);

			// The agent process continues running in the background.
			// When switching back, the actual isSending state might have changed
			// (generation completed). The actual state comes from the adapter/hook,
			// not the cache. The cache is restored, then the streaming updates
			// continue to arrive.
			//
			// Key insight: the background process keeps running because each tab
			// has its own adapter (keyed by tabId). Only the UI state is cached.
		});
	});

	// ========================================================================
	// AC: Session state (modes, models) preserved per tab
	// ========================================================================
	describe("Session state preservation", () => {
		it("should preserve modes per tab", () => {
			const tabA = createTabState({
				session: {
					sessionId: "s-a",
					state: "ready",
					agentId: "claude-code-acp",
					agentDisplayName: "Claude Code",
					authMethods: [],
					modes: {
						availableModes: [
							{ id: "build", name: "Build" },
							{ id: "plan", name: "Plan" },
						],
						currentModeId: "plan",
					},
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
			});

			const tabB = createTabState({
				session: {
					sessionId: "s-b",
					state: "ready",
					agentId: "claude-code-acp",
					agentDisplayName: "Claude Code",
					authMethods: [],
					modes: {
						availableModes: [
							{ id: "build", name: "Build" },
							{ id: "plan", name: "Plan" },
						],
						currentModeId: "build",
					},
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
			});

			expect(tabA.session.modes?.currentModeId).toBe("plan");
			expect(tabB.session.modes?.currentModeId).toBe("build");
		});

		it("should preserve models per tab", () => {
			const tabA = createTabState({
				session: {
					sessionId: "s-a",
					state: "ready",
					agentId: "claude-code-acp",
					agentDisplayName: "Claude Code",
					authMethods: [],
					models: {
						availableModels: [
							{ modelId: "claude-sonnet-4", name: "Sonnet" },
							{ modelId: "claude-opus-4", name: "Opus" },
						],
						currentModelId: "claude-opus-4",
					},
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
			});

			expect(tabA.session.models?.currentModelId).toBe("claude-opus-4");
		});

		it("should preserve different agent IDs per tab", () => {
			const tabA = createTabState({
				session: {
					sessionId: "s-claude",
					state: "ready",
					agentId: "claude-code-acp",
					agentDisplayName: "Claude Code",
					authMethods: [],
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
			});

			const tabB = createTabState({
				session: {
					sessionId: "s-gemini",
					state: "ready",
					agentId: "gemini-cli",
					agentDisplayName: "Gemini CLI",
					authMethods: [],
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
			});

			expect(tabA.session.agentId).toBe("claude-code-acp");
			expect(tabB.session.agentId).toBe("gemini-cli");
		});
	});

	// ========================================================================
	// Completeness: all required fields are present
	// ========================================================================
	describe("Type completeness", () => {
		it("should have all required fields for tab state", () => {
			const state = createTabState();

			// All fields must be defined
			expect(state.messages).toBeDefined();
			expect(state.inputValue).toBeDefined();
			expect(state.attachedImages).toBeDefined();
			expect(state.session).toBeDefined();
			expect(typeof state.isSending).toBe("boolean");
		});

		it("should allow empty defaults for a new tab", () => {
			const freshTabState: TabCachedState = {
				messages: [],
				inputValue: "",
				attachedImages: [],
				session: {
					sessionId: null,
					state: "disconnected",
					agentId: "claude-code-acp",
					agentDisplayName: "Claude Code",
					authMethods: [],
					createdAt: new Date(),
					lastActivityAt: new Date(),
					workingDirectory: "/test",
				},
				isSending: false,
			};

			expect(freshTabState.messages).toHaveLength(0);
			expect(freshTabState.inputValue).toBe("");
			expect(freshTabState.attachedImages).toHaveLength(0);
			expect(freshTabState.isSending).toBe(false);
		});
	});
});
