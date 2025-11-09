import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwitchAgentUseCase } from './switch-agent.use-case';
import type { ISettingsAccess } from '../domain/ports/settings-access.port';

describe('SwitchAgentUseCase', () => {
	let useCase: SwitchAgentUseCase;
	let mockSettingsAccess: ISettingsAccess;

	const mockSettings = {
		claude: {
			id: 'claude-code-acp',
			displayName: 'Claude Code',
			apiKey: '',
			command: '/usr/bin/claude-code-acp',
			args: [],
			env: [],
		},
		codex: {
			id: 'codex-acp',
			displayName: 'Codex',
			apiKey: '',
			command: '/usr/bin/codex-acp',
			args: [],
			env: [],
		},
		gemini: {
			id: 'gemini-cli',
			displayName: 'Gemini CLI',
			apiKey: '',
			command: '/usr/bin/gemini',
			args: ['--experimental-acp'],
			env: [],
		},
		customAgents: [
			{
				id: 'custom-agent-1',
				displayName: 'Custom Agent One',
				command: '/usr/bin/custom1',
				args: [],
				env: [],
			},
			{
				id: 'custom-agent-2',
				displayName: 'Custom Agent Two',
				command: '/usr/bin/custom2',
				args: [],
				env: [],
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
				autoExportOnNewChat: false,
				autoExportOnCloseChat: false,
				openFileAfterExport: true,
		},
		windowsWslMode: false,
	};

	beforeEach(() => {
		mockSettingsAccess = {
			getSnapshot: vi.fn(() => mockSettings),
			subscribe: vi.fn(),
			updateSettings: vi.fn(),
		};

		useCase = new SwitchAgentUseCase(mockSettingsAccess);
	});

	describe('getActiveAgentId', () => {
		it('should return active agent ID from settings', () => {
			const result = useCase.getActiveAgentId();

			expect(result).toBe('claude-code-acp');
		});

		it('should fall back to claude ID if activeAgentId not set', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				activeAgentId: '',
			});

			const result = useCase.getActiveAgentId();

			expect(result).toBe('claude-code-acp');
		});
	});

	describe('getCurrentAgent', () => {
		it('should return current agent info', () => {
			const result = useCase.getCurrentAgent();

			expect(result).toEqual({
				id: 'claude-code-acp',
				displayName: 'Claude Code',
			});
		});

		it('should return gemini agent when active', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				activeAgentId: 'gemini-cli',
			});

			const result = useCase.getCurrentAgent();

			expect(result).toEqual({
				id: 'gemini-cli',
				displayName: 'Gemini CLI',
			});
		});

		it('should return custom agent when active', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				activeAgentId: 'custom-agent-1',
			});

			const result = useCase.getCurrentAgent();

			expect(result).toEqual({
				id: 'custom-agent-1',
				displayName: 'Custom Agent One',
			});
		});

		it('should handle unknown agent ID gracefully', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				activeAgentId: 'unknown-agent',
			});

			const result = useCase.getCurrentAgent();

			expect(result).toEqual({
				id: 'unknown-agent',
				displayName: 'unknown-agent',
			});
		});
	});

	describe('getAvailableAgents', () => {
		it('should return all built-in and custom agents', () => {
			const result = useCase.getAvailableAgents();

			expect(result).toHaveLength(5);
			expect(result).toEqual([
				{
					id: 'claude-code-acp',
					displayName: 'Claude Code',
				},
				{
					id: 'codex-acp',
					displayName: 'Codex',
				},
				{
					id: 'gemini-cli',
					displayName: 'Gemini CLI',
				},
				{
					id: 'custom-agent-1',
					displayName: 'Custom Agent One',
				},
				{
					id: 'custom-agent-2',
					displayName: 'Custom Agent Two',
				},
			]);
		});

		it('should work with no custom agents', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				customAgents: [],
			});

			const result = useCase.getAvailableAgents();

			expect(result).toHaveLength(3);
			expect(result).toEqual([
				{
					id: 'claude-code-acp',
					displayName: 'Claude Code',
				},
				{
					id: 'codex-acp',
					displayName: 'Codex',
				},
				{
					id: 'gemini-cli',
					displayName: 'Gemini CLI',
				},
			]);
		});

		it('should use ID as displayName when displayName is empty', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettings,
				claude: {
					...mockSettings.claude,
					displayName: '',
				},
				customAgents: [
					{
						id: 'custom-no-name',
						displayName: '',
						command: '/usr/bin/custom',
						args: [],
						env: [],
					},
				],
			});

			const result = useCase.getAvailableAgents();

			expect(result[0]).toEqual({
				id: 'claude-code-acp',
				displayName: 'claude-code-acp',
			});

			expect(result[3]).toEqual({
				id: 'custom-no-name',
				displayName: 'custom-no-name',
			});
		});
	});

	describe('switchAgent', () => {
		it('should update active agent ID in settings', async () => {
			await useCase.switchAgent('gemini-cli');

			expect(mockSettingsAccess.updateSettings).toHaveBeenCalledWith({
				activeAgentId: 'gemini-cli',
			});
		});

		it('should allow switching to custom agent', async () => {
			await useCase.switchAgent('custom-agent-1');

			expect(mockSettingsAccess.updateSettings).toHaveBeenCalledWith({
				activeAgentId: 'custom-agent-1',
			});
		});

		it('should not validate agent ID (caller responsibility)', async () => {
			// Should accept any agent ID without validation
			await useCase.switchAgent('non-existent-agent');

			expect(mockSettingsAccess.updateSettings).toHaveBeenCalledWith({
				activeAgentId: 'non-existent-agent',
			});
		});
	});
});
