import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SendMessageUseCase } from './send-message.use-case';
import type { IAgentClient } from '../domain/ports/agent-client.port';
import type { IVaultAccess } from '../domain/ports/vault-access.port';
import type { ISettingsAccess } from '../domain/ports/settings-access.port';
import type { IMentionService } from '../../shared/mention-utils';
import type { TFile } from 'obsidian';

describe('SendMessageUseCase', () => {
	let useCase: SendMessageUseCase;
	let mockAgentClient: IAgentClient;
	let mockVaultAccess: IVaultAccess;
	let mockSettingsAccess: ISettingsAccess;
	let mockMentionService: IMentionService;

	beforeEach(() => {
		// モックの作成
		mockAgentClient = {
			sendMessage: vi.fn(),
			authenticate: vi.fn(),
			initialize: vi.fn(),
			newSession: vi.fn(),
			cancel: vi.fn(),
			disconnect: vi.fn(),
			onMessage: vi.fn(),
			onError: vi.fn(),
			onPermissionRequest: vi.fn(),
			respondToPermission: vi.fn(),
			isInitialized: vi.fn(),
			getCurrentAgentId: vi.fn(),
		};

		mockVaultAccess = {
			readNote: vi.fn(),
			searchNotes: vi.fn(),
			getActiveNote: vi.fn(),
			listNotes: vi.fn(),
		};

		mockSettingsAccess = {
			getSnapshot: vi.fn(() => ({
				autoMentionActiveNote: true,
				claude: {
					id: 'claude-code-acp',
					displayName: 'Claude Code',
					apiKey: '',
					command: '',
					args: [],
					env: [],
				},
				codex: {
					id: 'codex-acp',
					displayName: 'Codex',
					apiKey: '',
					command: '',
					args: [],
					env: [],
				},
				gemini: {
					id: 'gemini-cli',
					displayName: 'Gemini CLI',
					apiKey: '',
					command: '',
					args: [],
					env: [],
				},
				customAgents: [],
				activeAgentId: 'claude-code-acp',
				autoAllowPermissions: false,
				debugMode: false,
				nodePath: '',
				exportSettings: {
					defaultFolder: 'Agent Client',
					filenameTemplate: 'agent_client_{date}_{time}',
				},
				windowsWslMode: false,
			})),
			subscribe: vi.fn(),
			updateSettings: vi.fn(),
		};

		mockMentionService = {
			searchNotes: vi.fn(() => []),
			getAllFiles: vi.fn(() => []),
			findNoteByTitle: vi.fn(),
		};

		useCase = new SendMessageUseCase(
			mockAgentClient,
			mockVaultAccess,
			mockSettingsAccess,
			mockMentionService,
		);
	});

	describe('prepareMessage', () => {
		it('should return simple message as-is', async () => {
			const result = await useCase.prepareMessage({
				message: 'Hello, world!',
				vaultBasePath: '/vault',
				convertToWsl: false,
			});

			expect(result.displayMessage).toBe('Hello, world!');
			expect(result.agentMessage).toBe('Hello, world!');
			expect(result.autoMentionContext).toBeUndefined();
		});

		it('should add auto-mention for active note', async () => {
			vi.mocked(mockVaultAccess.readNote).mockResolvedValue(
				'Note content here',
			);

			const result = await useCase.prepareMessage({
				message: 'Test message',
				activeNote: {
					path: 'notes/test.md',
					name: 'test',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
				},
				vaultBasePath: '/vault',
				isAutoMentionDisabled: false,
				convertToWsl: false,
			});

			expect(result.displayMessage).toBe('Test message');
			expect(result.agentMessage).toContain('obsidian_opened_note');
			expect(result.agentMessage).toContain('/vault/notes/test.md');
			expect(result.autoMentionContext).toEqual({
				noteName: 'test',
				notePath: 'notes/test.md',
				selection: undefined,
			});
		});

		it('should include selection range in auto-mention', async () => {
			vi.mocked(mockVaultAccess.readNote).mockResolvedValue(
				'Line 1\nLine 2\nLine 3\nLine 4',
			);

			const result = await useCase.prepareMessage({
				message: 'Test message',
				activeNote: {
					path: 'notes/test.md',
					name: 'test',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
					selection: {
						from: { line: 1, ch: 0 },
						to: { line: 2, ch: 6 },
					},
				},
				vaultBasePath: '/vault',
				isAutoMentionDisabled: false,
				convertToWsl: false,
			});

			expect(result.agentMessage).toContain('selection="lines 2-3"');
			expect(result.agentMessage).toContain('Line 2');
			expect(result.agentMessage).toContain('Line 3');
			expect(result.autoMentionContext?.selection).toEqual({
				fromLine: 2,
				toLine: 3,
			});
		});

		it('should not add auto-mention when disabled', async () => {
			const result = await useCase.prepareMessage({
				message: 'Test message',
				activeNote: {
					path: 'notes/test.md',
					name: 'test',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
				},
				vaultBasePath: '/vault',
				isAutoMentionDisabled: true,
				convertToWsl: false,
			});

			expect(result.agentMessage).toBe('Test message');
			expect(result.autoMentionContext).toBeUndefined();
		});

		it('should convert @[[note]] mentions to context blocks', async () => {
			const mockFile = {
				path: 'notes/mentioned.md',
				basename: 'mentioned',
				name: 'mentioned',
				extension: 'md',
			} as TFile;

			// Mock getAllFiles to return the file
			vi.mocked(mockMentionService.getAllFiles).mockReturnValue([
				mockFile,
			]);

			vi.mocked(mockVaultAccess.readNote).mockResolvedValue(
				'Mentioned note content',
			);

			const result = await useCase.prepareMessage({
				message: 'Check @[[mentioned]] for details',
				vaultBasePath: '/vault',
				convertToWsl: false,
			});

			expect(result.agentMessage).toContain('obsidian_mentioned_note');
			expect(result.agentMessage).toContain('Mentioned note content');
			expect(result.agentMessage).toContain('/vault/notes/mentioned.md');
		});

		it('should truncate long note selections to 10000 characters', async () => {
			const longContent = 'a'.repeat(15000);
			vi.mocked(mockVaultAccess.readNote).mockResolvedValue(longContent);

			const result = await useCase.prepareMessage({
				message: 'Test',
				activeNote: {
					path: 'notes/long.md',
					name: 'long',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 100, ch: 0 },
					},
				},
				vaultBasePath: '/vault',
				isAutoMentionDisabled: false,
			});

			// Should truncate the selection text
			expect(result.agentMessage).toContain(
				'Note: The selection was truncated',
			);
		});

		it('should handle WSL path conversion', async () => {
			vi.mocked(mockVaultAccess.readNote).mockResolvedValue('Content');

			const result = await useCase.prepareMessage({
				message: 'Test',
				activeNote: {
					path: 'notes/test.md',
					name: 'test',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
				},
				vaultBasePath: 'C:\\Users\\test\\vault',
				isAutoMentionDisabled: false,
				convertToWsl: true,
			});

			expect(result.agentMessage).toContain(
				'/mnt/c/Users/test/vault/notes/test.md',
			);
		});
	});

	describe('sendPreparedMessage', () => {
		it('should send message successfully', async () => {
			vi.mocked(mockAgentClient.sendMessage).mockResolvedValue();

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Agent message',
				displayMessage: 'Display message',
				authMethods: [],
			});

			expect(result.success).toBe(true);
			expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
				'test-session',
				'Agent message',
			);
		});

		it('should retry with authentication when single auth method available', async () => {
			// 最初の送信は失敗
			vi.mocked(mockAgentClient.sendMessage)
				.mockRejectedValueOnce(new Error('Auth required'))
				.mockResolvedValueOnce(); // 2回目は成功

			vi.mocked(mockAgentClient.authenticate).mockResolvedValue(true);

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Test',
				displayMessage: 'Test',
				authMethods: [{ id: 'oauth', name: 'OAuth' }],
			});

			expect(mockAgentClient.authenticate).toHaveBeenCalledWith('oauth');
			expect(mockAgentClient.sendMessage).toHaveBeenCalledTimes(2);
			expect(result.success).toBe(true);
			expect(result.retriedSuccessfully).toBe(true);
		});

		it('should handle rate limit error correctly', async () => {
			const rateLimitError = {
				code: 429,
				message: 'Too many requests',
			};

			vi.mocked(mockAgentClient.sendMessage).mockRejectedValue(
				rateLimitError,
			);

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Test',
				displayMessage: 'Test',
				authMethods: [],
			});

			expect(result.success).toBe(false);
			expect(result.error?.category).toBe('rate_limit');
			expect(result.error?.title).toBe('Rate Limit Exceeded');
		});

		it('should ignore empty response text error', async () => {
			const emptyResponseError = {
				code: -32603,
				data: {
					details: 'empty response text',
				},
			};

			vi.mocked(mockAgentClient.sendMessage).mockRejectedValue(
				emptyResponseError,
			);

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Test',
				displayMessage: 'Test',
				authMethods: [],
			});

			// Should treat as success
			expect(result.success).toBe(true);
		});

		it('should return error when no auth methods available', async () => {
			vi.mocked(mockAgentClient.sendMessage).mockRejectedValue(
				new Error('Auth required'),
			);

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Test',
				displayMessage: 'Test',
				authMethods: [],
			});

			expect(result.success).toBe(false);
			expect(result.error?.category).toBe('authentication');
			expect(result.error?.title).toBe('No Authentication Methods');
		});

		it('should require auth when multiple auth methods available', async () => {
			vi.mocked(mockAgentClient.sendMessage).mockRejectedValue(
				new Error('Auth required'),
			);

			const result = await useCase.sendPreparedMessage({
				sessionId: 'test-session',
				agentMessage: 'Test',
				displayMessage: 'Test',
				authMethods: [
					{ id: 'oauth', name: 'OAuth' },
					{ id: 'api-key', name: 'API Key' },
				],
			});

			expect(result.success).toBe(false);
			expect(result.requiresAuth).toBe(true);
			expect(result.error?.category).toBe('authentication');
		});
	});

	describe('execute (legacy single-phase)', () => {
		it('should prepare and send message in one call', async () => {
			vi.mocked(mockAgentClient.sendMessage).mockResolvedValue();

			const result = await useCase.execute({
				sessionId: 'test-session',
				message: 'Hello',
				vaultBasePath: '/vault',
				authMethods: [],
			});

			expect(result.success).toBe(true);
			expect(result.displayMessage).toBe('Hello');
			expect(result.agentMessage).toBe('Hello');
			expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
				'test-session',
				'Hello',
			);
		});

		it('should include active note in legacy execute', async () => {
			vi.mocked(mockVaultAccess.readNote).mockResolvedValue(
				'Note content',
			);
			vi.mocked(mockAgentClient.sendMessage).mockResolvedValue();

			const result = await useCase.execute({
				sessionId: 'test-session',
				message: 'Test',
				activeNote: {
					path: 'notes/test.md',
					name: 'test',
					extension: 'md',
					created: Date.now(),
					modified: Date.now(),
				},
				vaultBasePath: '/vault',
				authMethods: [],
			});

			expect(result.success).toBe(true);
			expect(result.agentMessage).toContain('obsidian_opened_note');
		});
	});
});
