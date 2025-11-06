import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManageSessionUseCase } from './manage-session.use-case';
import type { IAgentClient } from '../domain/ports/agent-client.port';
import type { ISettingsAccess } from '../domain/ports/settings-access.port';

describe('ManageSessionUseCase', () => {
	let useCase: ManageSessionUseCase;
	let mockAgentClient: IAgentClient;
	let mockSettingsAccess: ISettingsAccess;

	const mockSettings = {
		claude: {
			id: 'claude-code-acp',
			displayName: 'Claude Code',
			apiKey: 'test-api-key',
			command: '/usr/bin/claude-code-acp',
			args: [],
			env: [],
		},
		codex: {
			id: 'codex-acp',
			displayName: 'Codex',
			apiKey: 'test-codex-key',
			command: '/usr/bin/codex-acp',
			args: [],
			env: [],
		},
		gemini: {
			id: 'gemini-cli',
			displayName: 'Gemini CLI',
			apiKey: 'test-gemini-key',
			command: '/usr/bin/gemini',
			args: ['--experimental-acp'],
			env: [],
		},
		customAgents: [
			{
				id: 'custom-agent',
				displayName: 'Custom Agent',
				command: '/usr/bin/custom-agent',
				args: [],
				env: [{ key: 'CUSTOM_KEY', value: 'custom-value' }],
			},
		],
		activeAgentId: 'claude-code-acp',
		autoAllowPermissions: false,
		autoMentionActiveNote: true,
		debugMode: false,
		nodePath: '',
		exportSettings: {
			defaultFolder: 'Agent Client',
			filenameTemplate: 'agent_client_{date}_{time}',
		},
		windowsWslMode: false,
	};

	beforeEach(() => {
		mockAgentClient = {
			initialize: vi.fn(),
			newSession: vi.fn(),
			authenticate: vi.fn(),
			sendMessage: vi.fn(),
			cancel: vi.fn(),
			disconnect: vi.fn(),
			onMessage: vi.fn(),
			onError: vi.fn(),
			onPermissionRequest: vi.fn(),
			respondToPermission: vi.fn(),
			isInitialized: vi.fn(),
			getCurrentAgentId: vi.fn(),
		};

		mockSettingsAccess = {
			getSnapshot: vi.fn(() => mockSettings),
			subscribe: vi.fn(),
			updateSettings: vi.fn(),
		};

		useCase = new ManageSessionUseCase(
			mockAgentClient,
			mockSettingsAccess,
		);
	});

	describe('createSession', () => {
		it('should initialize and create session for Claude', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(false);
			vi.mocked(mockAgentClient.initialize).mockResolvedValue({
				authMethods: [{ id: 'oauth', name: 'OAuth' }],
				protocolVersion: 1,
			});
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'test-session-123',
			});

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
			});

			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('test-session-123');
			expect(result.authMethods).toEqual([
				{ id: 'oauth', name: 'OAuth' },
			]);

			// Verify initialize was called with correct config
			expect(mockAgentClient.initialize).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'claude-code-acp',
					displayName: 'Claude Code',
					command: '/usr/bin/claude-code-acp',
					workingDirectory: '/test/vault',
					env: expect.objectContaining({
						ANTHROPIC_API_KEY: 'test-api-key',
					}),
				}),
			);

			// Verify newSession was called
			expect(mockAgentClient.newSession).toHaveBeenCalledWith(
				'/test/vault',
			);
		});

		it('should skip initialization if already initialized with same agent', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(true);
			vi.mocked(mockAgentClient.getCurrentAgentId).mockReturnValue(
				'claude-code-acp',
			);
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'test-session-456',
			});

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
			});

			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('test-session-456');

			// Should NOT call initialize
			expect(mockAgentClient.initialize).not.toHaveBeenCalled();

			// Should still call newSession
			expect(mockAgentClient.newSession).toHaveBeenCalled();
		});

		it('should re-initialize when switching agents', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(true);
			vi.mocked(mockAgentClient.getCurrentAgentId).mockReturnValue(
				'claude-code-acp',
			);
			vi.mocked(mockAgentClient.initialize).mockResolvedValue({
				authMethods: [],
				protocolVersion: 1,
			});
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'gemini-session',
			});

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'gemini-cli',
			});

			expect(result.success).toBe(true);

			// Should call initialize for new agent
			expect(mockAgentClient.initialize).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'gemini-cli',
					displayName: 'Gemini CLI',
					command: '/usr/bin/gemini',
					args: ['--experimental-acp'],
					env: expect.objectContaining({
						GOOGLE_API_KEY: 'test-gemini-key',
					}),
				}),
			);
		});

		it('should inject API key for Codex', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(false);
			vi.mocked(mockAgentClient.initialize).mockResolvedValue({
				authMethods: [],
				protocolVersion: 1,
			});
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'codex-session',
			});

			await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'codex-acp',
			});

			expect(mockAgentClient.initialize).toHaveBeenCalledWith(
				expect.objectContaining({
					env: expect.objectContaining({
						OPENAI_API_KEY: 'test-codex-key',
					}),
				}),
			);
		});

		it('should handle custom agent', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(false);
			vi.mocked(mockAgentClient.initialize).mockResolvedValue({
				authMethods: [],
				protocolVersion: 1,
			});
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'custom-session',
			});

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'custom-agent',
			});

			expect(result.success).toBe(true);

			expect(mockAgentClient.initialize).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'custom-agent',
					displayName: 'Custom Agent',
					command: '/usr/bin/custom-agent',
					env: expect.objectContaining({
						CUSTOM_KEY: 'custom-value',
					}),
				}),
			);
		});

		it('should return error for unknown agent', async () => {
			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'unknown-agent',
			});

			expect(result.success).toBe(false);
			expect(result.error?.category).toBe('configuration');
			expect(result.error?.title).toBe('Agent Not Found');
			expect(mockAgentClient.initialize).not.toHaveBeenCalled();
		});

		it('should handle initialization error', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(false);
			vi.mocked(mockAgentClient.initialize).mockRejectedValue(
				new Error('Failed to spawn process'),
			);

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
			});

			expect(result.success).toBe(false);
			expect(result.error?.category).toBe('connection');
			expect(result.error?.title).toBe('Session Creation Failed');
		});

		it('should handle newSession error', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(false);
			vi.mocked(mockAgentClient.initialize).mockResolvedValue({
				authMethods: [],
				protocolVersion: 1,
			});
			vi.mocked(mockAgentClient.newSession).mockRejectedValue(
				new Error('Session creation failed'),
			);

			const result = await useCase.createSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
			});

			expect(result.success).toBe(false);
			expect(result.error?.category).toBe('connection');
		});
	});

	describe('restartSession', () => {
		it('should cancel old session and create new one', async () => {
			vi.mocked(mockAgentClient.cancel).mockResolvedValue();
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(true);
			vi.mocked(mockAgentClient.getCurrentAgentId).mockReturnValue(
				'claude-code-acp',
			);
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'new-session',
			});

			const result = await useCase.restartSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
				currentSessionId: 'old-session',
			});

			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('new-session');
			expect(mockAgentClient.cancel).toHaveBeenCalledWith('old-session');
		});

		it('should ignore cancellation errors', async () => {
			vi.mocked(mockAgentClient.cancel).mockRejectedValue(
				new Error('Session already closed'),
			);
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(true);
			vi.mocked(mockAgentClient.getCurrentAgentId).mockReturnValue(
				'claude-code-acp',
			);
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'new-session',
			});

			const result = await useCase.restartSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
				currentSessionId: 'old-session',
			});

			// Should still succeed despite cancel error
			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('new-session');
		});

		it('should work without current session ID', async () => {
			vi.mocked(mockAgentClient.isInitialized).mockReturnValue(true);
			vi.mocked(mockAgentClient.getCurrentAgentId).mockReturnValue(
				'claude-code-acp',
			);
			vi.mocked(mockAgentClient.newSession).mockResolvedValue({
				sessionId: 'new-session',
			});

			const result = await useCase.restartSession({
				workingDirectory: '/test/vault',
				agentId: 'claude-code-acp',
				currentSessionId: null,
			});

			expect(result.success).toBe(true);
			expect(mockAgentClient.cancel).not.toHaveBeenCalled();
		});
	});

	describe('closeSession', () => {
		it('should cancel session', async () => {
			vi.mocked(mockAgentClient.cancel).mockResolvedValue();

			await useCase.closeSession('test-session');

			expect(mockAgentClient.cancel).toHaveBeenCalledWith('test-session');
		});

		it('should ignore errors when closing session', async () => {
			vi.mocked(mockAgentClient.cancel).mockRejectedValue(
				new Error('Already closed'),
			);

			// Should not throw
			await expect(
				useCase.closeSession('test-session'),
			).resolves.toBeUndefined();
		});

		it('should do nothing when session ID is null', async () => {
			await useCase.closeSession(null);

			expect(mockAgentClient.cancel).not.toHaveBeenCalled();
		});
	});

	describe('disconnect', () => {
		it('should disconnect agent client', async () => {
			vi.mocked(mockAgentClient.disconnect).mockResolvedValue();

			await useCase.disconnect();

			expect(mockAgentClient.disconnect).toHaveBeenCalled();
		});
	});
});
