import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentSession } from "../../src/hooks/useAgentSession";
import type { IAgentClient } from "../../src/domain/ports/agent-client.port";
import type { ISettingsAccess } from "../../src/domain/ports/settings-access.port";
import type { ChatSession } from "../../src/domain/models/chat-session";

/**
 * Tests for User Story 1.3: Switch Between Tabs - useAgentSession
 *
 * Tests the new restoreSessionSnapshot() method which directly sets
 * session state when switching back to a previously active tab.
 *
 * Acceptance Criteria:
 * - Session state (modes, models) preserved per tab
 * - restoreSessionSnapshot sets session state directly
 */

// ============================================================================
// Mock Factories
// ============================================================================

function createMockAgentClient(): IAgentClient {
	return {
		initialize: vi.fn().mockResolvedValue({
			authMethods: [],
			protocolVersion: 1,
		}),
		newSession: vi.fn().mockResolvedValue({
			sessionId: "session-1",
		}),
		authenticate: vi.fn(),
		sendPrompt: vi.fn(),
		cancel: vi.fn(),
		disconnect: vi.fn(),
		onSessionUpdate: vi.fn(),
		onError: vi.fn(),
		respondToPermission: vi.fn(),
		isInitialized: vi.fn().mockReturnValue(false),
		getCurrentAgentId: vi.fn().mockReturnValue(null),
		setSessionMode: vi.fn(),
		setSessionModel: vi.fn(),
		listSessions: vi.fn(),
		loadSession: vi.fn(),
		resumeSession: vi.fn(),
		forkSession: vi.fn(),
	};
}

function createMockSettingsAccess(): ISettingsAccess {
	const settings = {
		defaultAgentId: "claude-code-acp",
		claude: {
			id: "claude-code-acp",
			displayName: "Claude Code",
			command: "npx",
			args: [],
			apiKey: "test-key",
		},
		codex: {
			id: "codex-acp",
			displayName: "Codex",
			command: "npx",
			args: [],
			apiKey: "",
		},
		gemini: {
			id: "gemini-cli",
			displayName: "Gemini CLI",
			command: "npx",
			args: [],
			apiKey: "",
		},
		customAgents: [],
		lastUsedModels: {},
	};

	return {
		getSnapshot: vi.fn().mockReturnValue(settings),
		updateSettings: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue(() => {}),
		saveSession: vi.fn(),
		getSavedSessions: vi.fn().mockReturnValue([]),
		deleteSession: vi.fn(),
		saveSessionMessages: vi.fn(),
		loadSessionMessages: vi.fn(),
		deleteSessionMessages: vi.fn(),
	};
}

function createMockSession(overrides?: Partial<ChatSession>): ChatSession {
	return {
		sessionId: "session-42",
		state: "ready",
		agentId: "claude-code-acp",
		agentDisplayName: "Claude Code",
		authMethods: [],
		availableCommands: [
			{ name: "web", description: "Search the web" },
		],
		modes: {
			availableModes: [
				{ id: "build", name: "Build" },
				{ id: "plan", name: "Plan" },
			],
			currentModeId: "build",
		},
		models: {
			availableModels: [
				{ modelId: "claude-sonnet-4", name: "Claude Sonnet 4" },
				{ modelId: "claude-opus-4", name: "Claude Opus 4" },
			],
			currentModelId: "claude-sonnet-4",
		},
		promptCapabilities: { image: true },
		createdAt: new Date(2026, 1, 14, 10, 0, 0),
		lastActivityAt: new Date(2026, 1, 14, 10, 30, 0),
		workingDirectory: "/test/dir",
		...overrides,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("useAgentSession - User Story 1.3: restoreSessionSnapshot", () => {
	let mockAgentClient: IAgentClient;
	let mockSettingsAccess: ISettingsAccess;

	beforeEach(() => {
		mockAgentClient = createMockAgentClient();
		mockSettingsAccess = createMockSettingsAccess();
	});

	// ========================================================================
	// AC: Session state (modes, models) preserved per tab
	// ========================================================================
	describe("restoreSessionSnapshot", () => {
		it("should restore session state from a snapshot", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			const snapshot = createMockSession({
				sessionId: "snapshot-session-1",
				state: "ready",
				modes: {
					availableModes: [
						{ id: "build", name: "Build" },
						{ id: "plan", name: "Plan" },
					],
					currentModeId: "plan",
				},
				models: {
					availableModels: [
						{ modelId: "claude-sonnet-4", name: "Claude Sonnet 4" },
					],
					currentModelId: "claude-sonnet-4",
				},
			});

			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			expect(result.current.session.sessionId).toBe("snapshot-session-1");
			expect(result.current.session.state).toBe("ready");
			expect(result.current.session.modes?.currentModeId).toBe("plan");
			expect(result.current.session.models?.currentModelId).toBe("claude-sonnet-4");
		});

		it("should restore agentId and agentDisplayName", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			const snapshot = createMockSession({
				agentId: "gemini-cli",
				agentDisplayName: "Gemini CLI",
			});

			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			expect(result.current.session.agentId).toBe("gemini-cli");
			expect(result.current.session.agentDisplayName).toBe("Gemini CLI");
		});

		it("should restore availableCommands", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			const snapshot = createMockSession({
				availableCommands: [
					{ name: "test", description: "Run tests" },
					{ name: "web", description: "Web search" },
				],
			});

			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			expect(result.current.session.availableCommands).toHaveLength(2);
			expect(result.current.session.availableCommands?.[0].name).toBe("test");
		});

		it("should restore promptCapabilities", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			const snapshot = createMockSession({
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
			});

			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			expect(result.current.session.promptCapabilities?.image).toBe(true);
			expect(result.current.session.promptCapabilities?.embeddedContext).toBe(true);
		});

		it("should update isReady based on restored state", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			// Restore to ready state
			const readySnapshot = createMockSession({ state: "ready" });
			act(() => {
				result.current.restoreSessionSnapshot(readySnapshot);
			});
			expect(result.current.isReady).toBe(true);

			// Restore to initializing state
			const initSnapshot = createMockSession({ state: "initializing" });
			act(() => {
				result.current.restoreSessionSnapshot(initSnapshot);
			});
			expect(result.current.isReady).toBe(false);
		});

		it("should clear errorInfo when restoring snapshot", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			// Restore a valid session
			const snapshot = createMockSession({ state: "ready" });
			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			// errorInfo should be null after restore
			expect(result.current.errorInfo).toBeNull();
		});

		it("should not call any agent client methods (pure state restore)", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			const snapshot = createMockSession();

			act(() => {
				result.current.restoreSessionSnapshot(snapshot);
			});

			// restoreSessionSnapshot should NOT interact with the agent
			expect(mockAgentClient.initialize).not.toHaveBeenCalled();
			expect(mockAgentClient.newSession).not.toHaveBeenCalled();
			expect(mockAgentClient.disconnect).not.toHaveBeenCalled();
			expect(mockAgentClient.cancel).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Session state isolation: each tab's modes/models are preserved
	// (Simulated by saving and restoring different snapshots)
	// ========================================================================
	describe("Session state isolation between tabs", () => {
		it("should restore different modes for different tabs", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			// Tab A snapshot: "plan" mode
			const tabASnapshot = createMockSession({
				sessionId: "session-tab-a",
				modes: {
					availableModes: [
						{ id: "build", name: "Build" },
						{ id: "plan", name: "Plan" },
					],
					currentModeId: "plan",
				},
			});

			// Tab B snapshot: "build" mode
			const tabBSnapshot = createMockSession({
				sessionId: "session-tab-b",
				modes: {
					availableModes: [
						{ id: "build", name: "Build" },
						{ id: "plan", name: "Plan" },
					],
					currentModeId: "build",
				},
			});

			// Switch to Tab A
			act(() => {
				result.current.restoreSessionSnapshot(tabASnapshot);
			});
			expect(result.current.session.modes?.currentModeId).toBe("plan");
			expect(result.current.session.sessionId).toBe("session-tab-a");

			// Switch to Tab B
			act(() => {
				result.current.restoreSessionSnapshot(tabBSnapshot);
			});
			expect(result.current.session.modes?.currentModeId).toBe("build");
			expect(result.current.session.sessionId).toBe("session-tab-b");

			// Switch back to Tab A
			act(() => {
				result.current.restoreSessionSnapshot(tabASnapshot);
			});
			expect(result.current.session.modes?.currentModeId).toBe("plan");
			expect(result.current.session.sessionId).toBe("session-tab-a");
		});

		it("should restore different models for different tabs", () => {
			const { result } = renderHook(() =>
				useAgentSession(
					mockAgentClient,
					mockSettingsAccess,
					"/test/dir",
				),
			);

			// Tab A: using opus
			const tabASnapshot = createMockSession({
				models: {
					availableModels: [
						{ modelId: "claude-sonnet-4", name: "Sonnet" },
						{ modelId: "claude-opus-4", name: "Opus" },
					],
					currentModelId: "claude-opus-4",
				},
			});

			// Tab B: using sonnet
			const tabBSnapshot = createMockSession({
				models: {
					availableModels: [
						{ modelId: "claude-sonnet-4", name: "Sonnet" },
						{ modelId: "claude-opus-4", name: "Opus" },
					],
					currentModelId: "claude-sonnet-4",
				},
			});

			act(() => {
				result.current.restoreSessionSnapshot(tabASnapshot);
			});
			expect(result.current.session.models?.currentModelId).toBe("claude-opus-4");

			act(() => {
				result.current.restoreSessionSnapshot(tabBSnapshot);
			});
			expect(result.current.session.models?.currentModelId).toBe("claude-sonnet-4");
		});
	});
});
