import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	HandlePermissionUseCase,
	type PermissionRequest,
} from './handle-permission.use-case';
import type { IAgentClient } from '../domain/ports/agent-client.port';
import type { ISettingsAccess } from '../domain/ports/settings-access.port';

describe('HandlePermissionUseCase', () => {
	let useCase: HandlePermissionUseCase;
	let mockAgentClient: IAgentClient;
	let mockSettingsAccess: ISettingsAccess;

	const createMockPermissionRequest = (
		overrides?: Partial<PermissionRequest>,
	): PermissionRequest => ({
		requestId: 'test-request-123',
		toolCallId: 'tool-call-456',
		title: 'Read File',
		options: [
			{
				optionId: 'allow-once',
				name: 'Allow once',
				kind: 'allow_once',
			},
			{
				optionId: 'allow-always',
				name: 'Allow always',
				kind: 'allow_always',
			},
			{
				optionId: 'reject-once',
				name: 'Reject once',
				kind: 'reject_once',
			},
		],
		...overrides,
	});

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
			getSnapshot: vi.fn(() => ({
				autoAllowPermissions: false,
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
			})),
			subscribe: vi.fn(),
			updateSettings: vi.fn(),
		};

		useCase = new HandlePermissionUseCase(
			mockAgentClient,
			mockSettingsAccess,
		);
	});

	describe('approvePermission', () => {
		it('should approve permission successfully', async () => {
			vi.mocked(mockAgentClient.respondToPermission).mockResolvedValue();

			const result = await useCase.approvePermission({
				requestId: 'test-request',
				optionId: 'allow-once',
			});

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(mockAgentClient.respondToPermission).toHaveBeenCalledWith(
				'test-request',
				'allow-once',
			);
		});

		it('should handle approval error', async () => {
			vi.mocked(mockAgentClient.respondToPermission).mockRejectedValue(
				new Error('Failed to respond'),
			);

			const result = await useCase.approvePermission({
				requestId: 'test-request',
				optionId: 'allow-once',
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to respond to permission');
		});
	});

	describe('denyPermission', () => {
		it('should deny permission successfully', async () => {
			vi.mocked(mockAgentClient.respondToPermission).mockResolvedValue();

			const result = await useCase.denyPermission('test-request');

			expect(result.success).toBe(true);
			expect(mockAgentClient.respondToPermission).toHaveBeenCalledWith(
				'test-request',
				'reject',
			);
		});

		it('should handle denial error', async () => {
			vi.mocked(mockAgentClient.respondToPermission).mockRejectedValue(
				new Error('Failed to deny'),
			);

			const result = await useCase.denyPermission('test-request');

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to deny permission');
		});
	});

	describe('shouldAutoApprove', () => {
		it('should return false when auto-approval is disabled', () => {
			const result = useCase.shouldAutoApprove();

			expect(result).toBe(false);
		});

		it('should return true when auto-approval is enabled', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const result = useCase.shouldAutoApprove();

			expect(result).toBe(true);
		});
	});

	describe('getAutoApproveOption', () => {
		it('should return null when auto-approval is disabled', () => {
			const request = createMockPermissionRequest();

			const result = useCase.getAutoApproveOption(request);

			expect(result).toBeNull();
		});

		it('should prefer allow_once option', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest();

			const result = useCase.getAutoApproveOption(request);

			expect(result?.kind).toBe('allow_once');
			expect(result?.optionId).toBe('allow-once');
		});

		it('should fall back to allow_always if allow_once not available', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest({
				options: [
					{
						optionId: 'allow-always',
						name: 'Allow always',
						kind: 'allow_always',
					},
					{
						optionId: 'reject-once',
						name: 'Reject once',
						kind: 'reject_once',
					},
				],
			});

			const result = useCase.getAutoApproveOption(request);

			expect(result?.kind).toBe('allow_always');
			expect(result?.optionId).toBe('allow-always');
		});

		it('should fall back to option with "allow" in name', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest({
				options: [
					{
						optionId: 'custom-allow',
						name: 'Custom Allow',
						// @ts-ignore - testing fallback
						kind: 'custom',
					},
					{
						optionId: 'reject-once',
						name: 'Reject once',
						kind: 'reject_once',
					},
				],
			});

			const result = useCase.getAutoApproveOption(request);

			expect(result?.optionId).toBe('custom-allow');
		});

		it('should return first option as last resort', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest({
				options: [
					{
						optionId: 'first',
						name: 'First Option',
						// @ts-ignore - testing fallback
						kind: 'unknown',
					},
					{
						optionId: 'second',
						name: 'Second Option',
						// @ts-ignore - testing fallback
						kind: 'unknown',
					},
				],
			});

			const result = useCase.getAutoApproveOption(request);

			expect(result?.optionId).toBe('first');
		});

		it('should return null if no options available', () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest({
				options: [],
			});

			const result = useCase.getAutoApproveOption(request);

			expect(result).toBeNull();
		});
	});

	describe('autoApproveIfEnabled', () => {
		it('should return null when auto-approval is disabled', async () => {
			const request = createMockPermissionRequest();

			const result = await useCase.autoApproveIfEnabled(request);

			expect(result).toBeNull();
			expect(mockAgentClient.respondToPermission).not.toHaveBeenCalled();
		});

		it('should auto-approve with correct option', async () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});
			vi.mocked(mockAgentClient.respondToPermission).mockResolvedValue();

			const request = createMockPermissionRequest();

			const result = await useCase.autoApproveIfEnabled(request);

			expect(result?.success).toBe(true);
			expect(mockAgentClient.respondToPermission).toHaveBeenCalledWith(
				'test-request-123',
				'allow-once',
			);
		});

		it('should return null if no suitable option found', async () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});

			const request = createMockPermissionRequest({
				options: [],
			});

			const result = await useCase.autoApproveIfEnabled(request);

			expect(result).toBeNull();
		});

		it('should handle auto-approval error', async () => {
			vi.mocked(mockSettingsAccess.getSnapshot).mockReturnValue({
				...mockSettingsAccess.getSnapshot(),
				autoAllowPermissions: true,
			});
			vi.mocked(mockAgentClient.respondToPermission).mockRejectedValue(
				new Error('Auto-approval failed'),
			);

			const request = createMockPermissionRequest();

			const result = await useCase.autoApproveIfEnabled(request);

			expect(result?.success).toBe(false);
			expect(result?.error).toContain('Failed to respond to permission');
		});
	});
});
