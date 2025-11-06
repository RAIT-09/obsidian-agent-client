import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatViewModel } from './chat.view-model';
import type { SendMessageUseCase } from '../../core/use-cases/send-message.use-case';
import type { ManageSessionUseCase } from '../../core/use-cases/manage-session.use-case';
import type { HandlePermissionUseCase } from '../../core/use-cases/handle-permission.use-case';
import type { SwitchAgentUseCase } from '../../core/use-cases/switch-agent.use-case';
import type { IVaultAccess } from '../../core/domain/ports/vault-access.port';
import type AgentClientPlugin from '../../infrastructure/obsidian-plugin/plugin';
import type { ChatMessage, MessageContent } from '../../core/domain/models/chat-message';
import type { NoteMetadata } from '../../core/domain/ports/vault-access.port';

describe('ChatViewModel', () => {
	let viewModel: ChatViewModel;
	let mockPlugin: AgentClientPlugin;
	let mockSendMessageUseCase: SendMessageUseCase;
	let mockManageSessionUseCase: ManageSessionUseCase;
	let mockHandlePermissionUseCase: HandlePermissionUseCase;
	let mockSwitchAgentUseCase: SwitchAgentUseCase;
	let mockVaultAccess: IVaultAccess;
	const workingDirectory = '/test/vault';

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Mock Plugin
		mockPlugin = {
			settings: {
				autoMentionActiveNote: true,
				autoAllowPermissions: false,
				activeAgentId: 'claude-code-acp',
				claude: {
					id: 'claude-code-acp',
					displayName: 'Claude Code',
					apiKey: 'test-key',
					command: 'npx',
					args: ['@zed-industries/claude-code-acp'],
					env: [],
				},
				gemini: {
					id: 'gemini-cli',
					displayName: 'Gemini CLI',
					apiKey: '',
					command: 'npx',
					args: [],
					env: [],
				},
				customAgents: [],
				windowsWslMode: false,
				windowsWslDistribution: '',
				exportSettings: {
					defaultFolder: 'Agent Client',
				},
				debugMode: false,
			},
			saveSettings: vi.fn(),
		} as unknown as AgentClientPlugin;

		// Mock Use Cases
		mockSendMessageUseCase = {
			prepareMessage: vi.fn(),
			sendPreparedMessage: vi.fn(),
		} as unknown as SendMessageUseCase;

		mockManageSessionUseCase = {
			createSession: vi.fn(),
			closeSession: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as ManageSessionUseCase;

		mockHandlePermissionUseCase = {
			approvePermission: vi.fn(),
			shouldAutoApprove: vi.fn(),
			getAutoApproveOption: vi.fn(),
		} as unknown as HandlePermissionUseCase;

		mockSwitchAgentUseCase = {
			switchAgent: vi.fn(),
			getAvailableAgents: vi.fn(() => [
				{ id: 'claude-code-acp', displayName: 'Claude Code' },
				{ id: 'gemini-cli', displayName: 'Gemini CLI' },
			]),
			getActiveAgentId: vi.fn(() => 'claude-code-acp'),
		} as unknown as SwitchAgentUseCase;

		mockVaultAccess = {
			readNote: vi.fn(),
			searchNotes: vi.fn(),
			getActiveNote: vi.fn(),
			listNotes: vi.fn(),
		} as unknown as IVaultAccess;

		// Create ViewModel instance
		viewModel = new ChatViewModel(
			mockPlugin,
			mockSendMessageUseCase,
			mockManageSessionUseCase,
			mockHandlePermissionUseCase,
			mockSwitchAgentUseCase,
			mockVaultAccess,
			workingDirectory
		);
	});

	// ========================================
	// Observer Pattern Tests
	// ========================================

	describe('Observer Pattern', () => {
		it('should return current state snapshot', () => {
			const snapshot = viewModel.getSnapshot();

			expect(snapshot).toEqual(
				expect.objectContaining({
					messages: [],
					session: expect.objectContaining({
						sessionId: null,
						state: 'disconnected',
						agentId: 'claude-code-acp',
					}),
					errorInfo: null,
					isSending: false,
				})
			);
		});

		it('should notify listeners when state changes', async () => {
			const listener = vi.fn();
			viewModel.subscribe(listener);

			// Trigger state change
			viewModel.clearError();

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('should allow subscribing and unsubscribing', () => {
			const listener = vi.fn();
			const unsubscribe = viewModel.subscribe(listener);

			// Trigger state change
			viewModel.clearError();
			expect(listener).toHaveBeenCalledTimes(1);

			// Unsubscribe
			unsubscribe();

			// Trigger another state change
			viewModel.clearError();
			expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
		});

		it('should handle multiple listeners', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			const listener3 = vi.fn();

			viewModel.subscribe(listener1);
			viewModel.subscribe(listener2);
			viewModel.subscribe(listener3);

			// Trigger state change
			viewModel.clearError();

			expect(listener1).toHaveBeenCalledTimes(1);
			expect(listener2).toHaveBeenCalledTimes(1);
			expect(listener3).toHaveBeenCalledTimes(1);
		});

		it('should not notify unsubscribed listeners', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const unsubscribe1 = viewModel.subscribe(listener1);
			viewModel.subscribe(listener2);

			unsubscribe1();
			viewModel.clearError();

			expect(listener1).not.toHaveBeenCalled();
			expect(listener2).toHaveBeenCalledTimes(1);
		});
	});

	// ========================================
	// State Initialization Tests
	// ========================================

	describe('State Initialization', () => {
		it('should initialize with disconnected state', () => {
			const state = viewModel.getSnapshot();

			expect(state.session.state).toBe('disconnected');
			expect(state.session.sessionId).toBeNull();
			expect(state.messages).toEqual([]);
			expect(state.errorInfo).toBeNull();
			expect(state.isSending).toBe(false);
		});

		it('should initialize with active agent from SwitchAgentUseCase', () => {
			const state = viewModel.getSnapshot();

			expect(state.session.agentId).toBe('claude-code-acp');
			expect(mockSwitchAgentUseCase.getActiveAgentId).toHaveBeenCalled();
		});

		it('should initialize with working directory', () => {
			const state = viewModel.getSnapshot();

			expect(state.session.workingDirectory).toBe('/test/vault');
		});

		it('should initialize mention dropdown state', () => {
			const state = viewModel.getSnapshot();

			expect(state.showMentionDropdown).toBe(false);
			expect(state.mentionSuggestions).toEqual([]);
			expect(state.selectedMentionIndex).toBe(0);
			expect(state.mentionContext).toBeNull();
		});

		it('should initialize slash command dropdown state', () => {
			const state = viewModel.getSnapshot();

			expect(state.showSlashCommandDropdown).toBe(false);
			expect(state.slashCommandSuggestions).toEqual([]);
			expect(state.selectedSlashCommandIndex).toBe(0);
		});
	});

	// ========================================
	// Computed Properties Tests
	// ========================================

	describe('Computed Properties', () => {
		describe('isReady', () => {
			it('should return true when session is ready and not sending', () => {
				// Manually set state to ready (simulate successful session creation)
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						state: 'ready',
					},
					isSending: false,
				};

				expect(viewModel.isReady).toBe(true);
			});

			it('should return false when session is not ready', () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						state: 'disconnected',
					},
					isSending: false,
				};

				expect(viewModel.isReady).toBe(false);
			});

			it('should return false when sending', () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						state: 'ready',
					},
					isSending: true,
				};

				expect(viewModel.isReady).toBe(false);
			});
		});

		describe('canSendMessage', () => {
			it('should return true when session has ID and is ready', () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session-123',
						state: 'ready',
					},
				};

				expect(viewModel.canSendMessage).toBe(true);
			});

			it('should return false when session has no ID', () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: null,
						state: 'ready',
					},
				};

				expect(viewModel.canSendMessage).toBe(false);
			});

			it('should return false when session is not ready', () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session-123',
						state: 'initializing',
					},
				};

				expect(viewModel.canSendMessage).toBe(false);
			});
		});
	});

	// ========================================
	// Session Management Tests
	// ========================================

	describe('Session Management', () => {
		describe('createNewSession', () => {
			it('should transition to initializing state immediately', async () => {
				const listener = vi.fn();
				viewModel.subscribe(listener);

				// Mock successful session creation (doesn't resolve immediately)
				vi.mocked(mockManageSessionUseCase.createSession).mockImplementation(
					() => new Promise(() => {}) // Never resolves
				);

				const promise = viewModel.createNewSession();

				// State should be updated immediately (synchronously)
				expect(viewModel.getSnapshot().session.state).toBe('initializing');
				expect(viewModel.getSnapshot().messages).toEqual([]);
				expect(viewModel.getSnapshot().errorInfo).toBeNull();

				// Cleanup
				await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, 10))]);
			});

			it('should create session and transition to ready state on success', async () => {
				vi.mocked(mockManageSessionUseCase.createSession).mockResolvedValue({
					success: true,
					sessionId: 'test-session-123',
					authMethods: [{ id: 'oauth', name: 'OAuth' }],
				});

				await viewModel.createNewSession();

				const state = viewModel.getSnapshot();
				expect(state.session.state).toBe('ready');
				expect(state.session.sessionId).toBe('test-session-123');
				expect(state.session.authMethods).toEqual([
					{ id: 'oauth', name: 'OAuth' },
				]);
				expect(mockManageSessionUseCase.createSession).toHaveBeenCalledWith({
					workingDirectory: '/test/vault',
					agentId: 'claude-code-acp',
				});
			});

			it('should handle session creation failure', async () => {
				vi.mocked(mockManageSessionUseCase.createSession).mockResolvedValue({
					success: false,
					error: {
						title: 'Connection Failed',
						message: 'Could not connect to agent',
						suggestion: 'Check your network connection',
					},
				});

				await viewModel.createNewSession();

				const state = viewModel.getSnapshot();
				expect(state.session.state).toBe('error');
				expect(state.errorInfo).toEqual({
					title: 'Connection Failed',
					message: 'Could not connect to agent',
					suggestion: 'Check your network connection',
				});
			});

			it('should handle unexpected errors', async () => {
				vi.mocked(mockManageSessionUseCase.createSession).mockRejectedValue(
					new Error('Network timeout')
				);

				await viewModel.createNewSession();

				const state = viewModel.getSnapshot();
				expect(state.session.state).toBe('error');
				expect(state.errorInfo).toEqual(
					expect.objectContaining({
						title: 'Session Creation Failed',
						message: expect.stringContaining('Network timeout'),
					})
				);
			});

			it('should clear messages and reset state', async () => {
				// Add some messages first
				const message: ChatMessage = {
					id: 'msg-1',
					role: 'user',
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(message);

				vi.mocked(mockManageSessionUseCase.createSession).mockResolvedValue({
					success: true,
					sessionId: 'new-session',
				});

				await viewModel.createNewSession();

				expect(viewModel.getSnapshot().messages).toEqual([]);
			});
		});

		describe('restartSession', () => {
			it('should call createNewSession', async () => {
				const createSpy = vi.spyOn(viewModel, 'createNewSession');
				vi.mocked(mockManageSessionUseCase.createSession).mockResolvedValue({
					success: true,
					sessionId: 'restarted-session',
				});

				await viewModel.restartSession();

				expect(createSpy).toHaveBeenCalled();
			});
		});

		describe('cancelCurrentOperation', () => {
			it('should cancel operation and return to ready state', async () => {
				// Set up state as if sending
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session',
						state: 'busy',
					},
					isSending: true,
				};

				vi.mocked(mockManageSessionUseCase.closeSession).mockResolvedValue();

				await viewModel.cancelCurrentOperation();

				const state = viewModel.getSnapshot();
				expect(state.isSending).toBe(false);
				expect(state.session.state).toBe('ready');
				expect(mockManageSessionUseCase.closeSession).toHaveBeenCalledWith(
					'test-session'
				);
			});

			it('should handle cancel failure gracefully', async () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session',
						state: 'busy',
					},
					isSending: true,
				};

				vi.mocked(mockManageSessionUseCase.closeSession).mockRejectedValue(
					new Error('Cancel failed')
				);

				await viewModel.cancelCurrentOperation();

				// Should still update UI to ready state despite error
				const state = viewModel.getSnapshot();
				expect(state.isSending).toBe(false);
				expect(state.session.state).toBe('ready');
			});

			it('should do nothing when no session ID', async () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: null,
					},
				};

				await viewModel.cancelCurrentOperation();

				expect(mockManageSessionUseCase.closeSession).not.toHaveBeenCalled();
			});
		});

		describe('disconnect', () => {
			it('should close session and disconnect', async () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session',
						state: 'ready',
					},
				};

				vi.mocked(mockManageSessionUseCase.closeSession).mockResolvedValue();
				vi.mocked(mockManageSessionUseCase.disconnect).mockResolvedValue();

				await viewModel.disconnect();

				expect(mockManageSessionUseCase.closeSession).toHaveBeenCalledWith(
					'test-session'
				);
				expect(mockManageSessionUseCase.disconnect).toHaveBeenCalled();

				const state = viewModel.getSnapshot();
				expect(state.session.sessionId).toBeNull();
				expect(state.session.state).toBe('disconnected');
			});
		});
	});

	// ========================================
	// Message Operations Tests
	// ========================================

	describe('Message Operations', () => {
		describe('sendMessage', () => {
			beforeEach(() => {
				// Set up ready state
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: 'test-session',
						state: 'ready',
					},
				};
			});

			it('should prepare message and add to UI immediately', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Hello, world!',
					agentMessage: 'Hello, world!',
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockResolvedValue({
					success: true,
				});

				// Wait for sendMessage to complete
				await viewModel.sendMessage('Hello, world!', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				const state = viewModel.getSnapshot();
				expect(state.messages).toHaveLength(1);
				expect(state.messages[0].role).toBe('user');
				expect(state.messages[0].content[0]).toEqual({
					type: 'text',
					text: 'Hello, world!',
				});
			});

			it('should set isSending to true and session to busy', async () => {
				// Use a promise we can control
				let resolvePrepare: (value: any) => void;
				const preparePromise = new Promise((resolve) => {
					resolvePrepare = resolve;
				});

				vi.mocked(mockSendMessageUseCase.prepareMessage).mockReturnValue(
					preparePromise as any
				);

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockImplementation(() => new Promise(() => {})); // Never resolves

				// Start sending
				const sendPromise = viewModel.sendMessage('Test', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				// Resolve prepare, which triggers state update
				resolvePrepare!({
					displayMessage: 'Test',
					agentMessage: 'Test',
				});

				// Wait for prepare to complete and state to update
				await new Promise((resolve) => setTimeout(resolve, 10));

				const state = viewModel.getSnapshot();
				expect(state.isSending).toBe(true);
				expect(state.session.state).toBe('busy');

				// Cleanup - don't wait for the never-resolving promise
				await Promise.race([
					sendPromise,
					new Promise((resolve) => setTimeout(resolve, 10)),
				]);
			});

			it('should store lastUserMessage for cancel recovery', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Test message',
					agentMessage: 'Test message',
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockResolvedValue({
					success: true,
				});

				await viewModel.sendMessage('Test message', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				// After success, lastUserMessage should be cleared
				const state = viewModel.getSnapshot();
				expect(state.lastUserMessage).toBeNull();
			});

			it('should handle send success and return to ready state', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Hello',
					agentMessage: 'Hello',
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockResolvedValue({
					success: true,
				});

				await viewModel.sendMessage('Hello', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				const state = viewModel.getSnapshot();
				expect(state.isSending).toBe(false);
				expect(state.session.state).toBe('ready');
			});

			it('should handle send failure and set error', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Hello',
					agentMessage: 'Hello',
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockResolvedValue({
					success: false,
					error: {
						title: 'Send Failed',
						message: 'Network error',
					},
				});

				await viewModel.sendMessage('Hello', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				const state = viewModel.getSnapshot();
				expect(state.isSending).toBe(false);
				expect(state.session.state).toBe('ready');
				expect(state.errorInfo).toEqual({
					title: 'Send Failed',
					message: 'Network error',
				});
			});

			it('should handle unexpected errors', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Hello',
					agentMessage: 'Hello',
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockRejectedValue(new Error('Connection lost'));

				await viewModel.sendMessage('Hello', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				const state = viewModel.getSnapshot();
				expect(state.errorInfo).toEqual(
					expect.objectContaining({
						title: 'Send Message Failed',
						message: expect.stringContaining('Connection lost'),
					})
				);
			});

			it('should not send when canSendMessage is false', async () => {
				viewModel['state'] = {
					...viewModel['state'],
					session: {
						...viewModel['state'].session,
						sessionId: null, // No session ID
						state: 'disconnected',
					},
				};

				await viewModel.sendMessage('Test', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				expect(mockSendMessageUseCase.prepareMessage).not.toHaveBeenCalled();
			});

			it('should include auto-mention context when provided', async () => {
				vi.mocked(mockSendMessageUseCase.prepareMessage).mockResolvedValue({
					displayMessage: 'Check this',
					agentMessage: 'Check this',
					autoMentionContext: {
						path: '/vault/note.md',
						content: 'Note content',
					},
				});

				vi.mocked(
					mockSendMessageUseCase.sendPreparedMessage
				).mockResolvedValue({
					success: true,
				});

				await viewModel.sendMessage('Check this', {
					activeNote: null,
					vaultBasePath: '/vault',
				});

				const state = viewModel.getSnapshot();
				const userMessage = state.messages[0];
				expect(userMessage.content[0]).toEqual({
					type: 'text_with_context',
					text: 'Check this',
					autoMentionContext: {
						path: '/vault/note.md',
						content: 'Note content',
					},
				});
			});
		});

		describe('addMessage', () => {
			it('should add message to state', () => {
				const message: ChatMessage = {
					id: 'msg-1',
					role: 'user',
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: new Date(),
				};

				viewModel.addMessage(message);

				const state = viewModel.getSnapshot();
				expect(state.messages).toHaveLength(1);
				expect(state.messages[0]).toEqual(message);
			});

			it('should append to existing messages', () => {
				const message1: ChatMessage = {
					id: 'msg-1',
					role: 'user',
					content: [{ type: 'text', text: 'First' }],
					timestamp: new Date(),
				};

				const message2: ChatMessage = {
					id: 'msg-2',
					role: 'assistant',
					content: [{ type: 'text', text: 'Second' }],
					timestamp: new Date(),
				};

				viewModel.addMessage(message1);
				viewModel.addMessage(message2);

				const state = viewModel.getSnapshot();
				expect(state.messages).toHaveLength(2);
				expect(state.messages[0]).toEqual(message1);
				expect(state.messages[1]).toEqual(message2);
			});
		});

		describe('updateLastMessage', () => {
			it('should create new assistant message if none exists', () => {
				const content: MessageContent = {
					type: 'text',
					text: 'Assistant response',
				};

				viewModel.updateLastMessage(content);

				const state = viewModel.getSnapshot();
				expect(state.messages).toHaveLength(1);
				expect(state.messages[0].role).toBe('assistant');
				expect(state.messages[0].content).toEqual([content]);
			});

			it('should create new assistant message if last is user message', () => {
				const userMessage: ChatMessage = {
					id: 'msg-1',
					role: 'user',
					content: [{ type: 'text', text: 'User message' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(userMessage);

				const content: MessageContent = {
					type: 'text',
					text: 'Assistant response',
				};
				viewModel.updateLastMessage(content);

				const state = viewModel.getSnapshot();
				expect(state.messages).toHaveLength(2);
				expect(state.messages[1].role).toBe('assistant');
			});

			it('should append text to existing text content', () => {
				const assistantMessage: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(assistantMessage);

				viewModel.updateLastMessage({ type: 'text', text: ' world' });

				const state = viewModel.getSnapshot();
				expect(state.messages[0].content).toEqual([
					{ type: 'text', text: 'Hello world' },
				]);
			});

			it('should append agent_thought with newline separator', () => {
				const assistantMessage: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [{ type: 'agent_thought', text: 'Thinking...' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(assistantMessage);

				viewModel.updateLastMessage({
					type: 'agent_thought',
					text: 'More thoughts',
				});

				const state = viewModel.getSnapshot();
				expect(state.messages[0].content).toEqual([
					{ type: 'agent_thought', text: 'Thinking...\nMore thoughts' },
				]);
			});

			it('should add new content type if not exists', () => {
				const assistantMessage: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(assistantMessage);

				viewModel.updateLastMessage({
					type: 'agent_thought',
					text: 'Thinking',
				});

				const state = viewModel.getSnapshot();
				expect(state.messages[0].content).toHaveLength(2);
				expect(state.messages[0].content[1]).toEqual({
					type: 'agent_thought',
					text: 'Thinking',
				});
			});

			it('should replace non-text content', () => {
				const assistantMessage: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [
						{
							type: 'tool_call',
							toolCallId: 'tool-1',
							title: 'Old Title',
							kind: 'read',
							status: 'pending',
						},
					],
					timestamp: new Date(),
				};
				viewModel.addMessage(assistantMessage);

				viewModel.updateLastMessage({
					type: 'tool_call',
					toolCallId: 'tool-1',
					title: 'New Title',
					kind: 'read',
					status: 'completed',
				});

				const state = viewModel.getSnapshot();
				expect(state.messages[0].content[0]).toEqual(
					expect.objectContaining({
						title: 'New Title',
						status: 'completed',
					})
				);
			});
		});

		describe('updateMessage', () => {
			it('should update tool call by ID', () => {
				const message: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [
						{
							type: 'tool_call',
							toolCallId: 'tool-123',
							title: 'Reading file',
							kind: 'read',
							status: 'pending',
						},
					],
					timestamp: new Date(),
				};
				viewModel.addMessage(message);

				const updated = viewModel.updateMessage('tool-123', {
					type: 'tool_call',
					toolCallId: 'tool-123',
					title: 'Reading file',
					kind: 'read',
					status: 'completed',
				});

				expect(updated).toBe(true);

				const state = viewModel.getSnapshot();
				expect(state.messages[0].content[0]).toEqual(
					expect.objectContaining({
						status: 'completed',
					})
				);
			});

			it('should return false when tool call ID not found', () => {
				const message: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: new Date(),
				};
				viewModel.addMessage(message);

				const updated = viewModel.updateMessage('nonexistent', {
					type: 'tool_call',
					toolCallId: 'nonexistent',
					title: 'Test',
					kind: 'read',
					status: 'pending',
				});

				expect(updated).toBe(false);
			});

			it('should merge tool call content arrays', () => {
				const message: ChatMessage = {
					id: 'msg-1',
					role: 'assistant',
					content: [
						{
							type: 'tool_call',
							toolCallId: 'tool-1',
							title: 'Edit file',
							kind: 'edit',
							status: 'in_progress',
							content: [
								{
									type: 'diff',
									path: '/test.ts',
									newText: 'new content',
								},
							],
						},
					],
					timestamp: new Date(),
				};
				viewModel.addMessage(message);

				viewModel.updateMessage('tool-1', {
					type: 'tool_call',
					toolCallId: 'tool-1',
					title: 'Edit file',
					kind: 'edit',
					status: 'completed',
					content: [
						{
							type: 'terminal',
							terminalId: 'term-1',
						},
					],
				});

				const state = viewModel.getSnapshot();
				const toolCall = state.messages[0].content[0];
				if (toolCall.type === 'tool_call') {
					expect(toolCall.content).toHaveLength(2);
				}
			});
		});

		describe('clearError', () => {
			it('should clear error info', () => {
				viewModel['state'] = {
					...viewModel['state'],
					errorInfo: {
						title: 'Error',
						message: 'Something went wrong',
					},
				};

				viewModel.clearError();

				expect(viewModel.getSnapshot().errorInfo).toBeNull();
			});
		});

		describe('updateAvailableCommands', () => {
			it('should update session available commands', () => {
				const commands = [
					{ name: 'web', description: 'Search the web', hint: 'query' },
					{ name: 'test', description: 'Run tests', hint: null },
				];

				viewModel.updateAvailableCommands(commands);

				const state = viewModel.getSnapshot();
				expect(state.session.availableCommands).toEqual(commands);
			});
		});
	});

	// ========================================
	// Permission Handling Tests
	// ========================================

	describe('Permission Handling', () => {
		it('should approve permission successfully', async () => {
			vi.mocked(
				mockHandlePermissionUseCase.approvePermission
			).mockResolvedValue({
				success: true,
			});

			await viewModel.approvePermission('req-123', 'allow_once');

			expect(
				mockHandlePermissionUseCase.approvePermission
			).toHaveBeenCalledWith({
				requestId: 'req-123',
				optionId: 'allow_once',
			});
		});

		it('should set error on permission approval failure', async () => {
			vi.mocked(
				mockHandlePermissionUseCase.approvePermission
			).mockResolvedValue({
				success: false,
				error: 'Permission denied by agent',
			});

			await viewModel.approvePermission('req-123', 'allow_once');

			const state = viewModel.getSnapshot();
			expect(state.errorInfo).toEqual({
				title: 'Permission Error',
				message: 'Permission denied by agent',
			});
		});

		it('should handle unexpected errors', async () => {
			vi.mocked(
				mockHandlePermissionUseCase.approvePermission
			).mockRejectedValue(new Error('Network error'));

			await viewModel.approvePermission('req-123', 'allow_once');

			const state = viewModel.getSnapshot();
			expect(state.errorInfo).toEqual(
				expect.objectContaining({
					title: 'Permission Error',
					message: expect.stringContaining('Network error'),
				})
			);
		});
	});

	// ========================================
	// Agent Management Tests
	// ========================================

	describe('Agent Management', () => {
		describe('switchAgent', () => {
			it('should switch to new agent', async () => {
				vi.mocked(mockSwitchAgentUseCase.switchAgent).mockResolvedValue();

				await viewModel.switchAgent('gemini-cli');

				expect(mockSwitchAgentUseCase.switchAgent).toHaveBeenCalledWith(
					'gemini-cli'
				);

				const state = viewModel.getSnapshot();
				expect(state.session.agentId).toBe('gemini-cli');
			});

			it('should clear availableCommands when switching agent', async () => {
				// Set some commands
				viewModel.updateAvailableCommands([
					{ name: 'test', description: 'Test', hint: null },
				]);

				vi.mocked(mockSwitchAgentUseCase.switchAgent).mockResolvedValue();

				await viewModel.switchAgent('gemini-cli');

				const state = viewModel.getSnapshot();
				expect(state.session.availableCommands).toBeUndefined();
			});
		});

		describe('getAvailableAgents', () => {
			it('should return available agents', () => {
				const agents = viewModel.getAvailableAgents();

				expect(agents).toEqual([
					{ id: 'claude-code-acp', displayName: 'Claude Code' },
					{ id: 'gemini-cli', displayName: 'Gemini CLI' },
				]);
				expect(mockSwitchAgentUseCase.getAvailableAgents).toHaveBeenCalled();
			});
		});
	});

	// ========================================
	// Mention Management Tests
	// ========================================

	describe('Mention Management', () => {
		describe('updateMentionSuggestions', () => {
			it('should show dropdown when @ is detected', async () => {
				const mockNotes: NoteMetadata[] = [
					{
						path: 'notes/test.md',
						name: 'test',
						basename: 'test',
						extension: 'md',
					},
				];
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue(mockNotes);

				await viewModel.updateMentionSuggestions('Check @te', 9);

				const state = viewModel.getSnapshot();
				expect(state.showMentionDropdown).toBe(true);
				expect(state.mentionSuggestions).toEqual(mockNotes);
				expect(state.selectedMentionIndex).toBe(0);
				expect(state.mentionContext).toEqual(
					expect.objectContaining({
						query: 'te',
					})
				);
			});

			it('should close dropdown when no mention context', async () => {
				// First show dropdown
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue([
					{
						path: 'test.md',
						name: 'test',
						basename: 'test',
						extension: 'md',
					},
				]);
				await viewModel.updateMentionSuggestions('Check @test', 11);

				// Then type something without @
				await viewModel.updateMentionSuggestions('Check test', 10);

				const state = viewModel.getSnapshot();
				expect(state.showMentionDropdown).toBe(false);
				expect(state.mentionSuggestions).toEqual([]);
				expect(state.mentionContext).toBeNull();
			});

			it('should search notes with query', async () => {
				await viewModel.updateMentionSuggestions('See @example', 12);

				expect(mockVaultAccess.searchNotes).toHaveBeenCalledWith('example');
			});
		});

		describe('selectMention', () => {
			it('should replace mention with selected note', async () => {
				// Set up mention context
				const mockNotes: NoteMetadata[] = [
					{
						path: 'notes/selected.md',
						name: 'selected',
						basename: 'selected',
						extension: 'md',
					},
				];
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue(mockNotes);
				await viewModel.updateMentionSuggestions('Check @sel', 10);

				const result = viewModel.selectMention('Check @sel', mockNotes[0]);

				expect(result).toContain('@[[selected]]');
			});

			it('should close dropdown after selection', async () => {
				const mockNote: NoteMetadata = {
					path: 'test.md',
					name: 'test',
					basename: 'test',
					extension: 'md',
				};
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue([mockNote]);
				await viewModel.updateMentionSuggestions('Check @t', 8);

				viewModel.selectMention('Check @t', mockNote);

				const state = viewModel.getSnapshot();
				expect(state.showMentionDropdown).toBe(false);
				expect(state.mentionContext).toBeNull();
			});

			it('should return original text when no mention context', () => {
				const mockNote: NoteMetadata = {
					path: 'test.md',
					name: 'test',
					basename: 'test',
					extension: 'md',
				};

				const result = viewModel.selectMention('No mention here', mockNote);

				expect(result).toBe('No mention here');
			});
		});

		describe('closeMentionDropdown', () => {
			it('should close dropdown and clear state', async () => {
				// First show dropdown
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue([
					{
						path: 'test.md',
						name: 'test',
						basename: 'test',
						extension: 'md',
					},
				]);
				await viewModel.updateMentionSuggestions('Check @test', 11);

				viewModel.closeMentionDropdown();

				const state = viewModel.getSnapshot();
				expect(state.showMentionDropdown).toBe(false);
				expect(state.mentionSuggestions).toEqual([]);
				expect(state.selectedMentionIndex).toBe(0);
				expect(state.mentionContext).toBeNull();
			});
		});

		describe('navigateMentionDropdown', () => {
			beforeEach(async () => {
				// Set up dropdown with 3 items
				const mockNotes: NoteMetadata[] = [
					{ path: '1.md', name: 'one', basename: 'one', extension: 'md' },
					{ path: '2.md', name: 'two', basename: 'two', extension: 'md' },
					{ path: '3.md', name: 'three', basename: 'three', extension: 'md' },
				];
				vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue(mockNotes);
				await viewModel.updateMentionSuggestions('Check @', 7);
			});

			it('should navigate down', () => {
				viewModel.navigateMentionDropdown('down');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(1);

				viewModel.navigateMentionDropdown('down');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(2);
			});

			it('should not go beyond max index', () => {
				viewModel.navigateMentionDropdown('down');
				viewModel.navigateMentionDropdown('down');
				viewModel.navigateMentionDropdown('down');
				viewModel.navigateMentionDropdown('down');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(2); // Max is 2
			});

			it('should navigate up', () => {
				// Go to index 2
				viewModel.navigateMentionDropdown('down');
				viewModel.navigateMentionDropdown('down');

				// Go back up
				viewModel.navigateMentionDropdown('up');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(1);
			});

			it('should not go below 0', () => {
				viewModel.navigateMentionDropdown('up');
				viewModel.navigateMentionDropdown('up');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(0);
			});

			it('should do nothing when dropdown not shown', () => {
				viewModel.closeMentionDropdown();

				viewModel.navigateMentionDropdown('down');

				expect(viewModel.getSnapshot().selectedMentionIndex).toBe(0);
			});
		});

		describe('toggleAutoMention', () => {
			it('should enable auto-mention', () => {
				viewModel.toggleAutoMention(false);

				expect(
					viewModel.getSnapshot().isAutoMentionTemporarilyDisabled
				).toBe(false);
			});

			it('should disable auto-mention', () => {
				viewModel.toggleAutoMention(true);

				expect(
					viewModel.getSnapshot().isAutoMentionTemporarilyDisabled
				).toBe(true);
			});
		});
	});

	// ========================================
	// Slash Command Management Tests
	// ========================================

	describe('Slash Command Management', () => {
		beforeEach(() => {
			// Set up some available commands
			const commands = [
				{ name: 'web', description: 'Search the web', hint: 'query' },
				{ name: 'test', description: 'Run tests', hint: null },
				{ name: 'plan', description: 'Create a plan', hint: null },
			];
			viewModel.updateAvailableCommands(commands);
		});

		describe('updateSlashCommandSuggestions', () => {
			it('should show dropdown when / is at start', () => {
				viewModel.updateSlashCommandSuggestions('/', 1);

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(true);
				expect(state.slashCommandSuggestions.length).toBeGreaterThan(0);
			});

			it('should filter commands by query', () => {
				viewModel.updateSlashCommandSuggestions('/web', 4);

				const state = viewModel.getSnapshot();
				expect(state.slashCommandSuggestions).toHaveLength(1);
				expect(state.slashCommandSuggestions[0].name).toBe('web');
			});

			it('should disable auto-mention when slash command active', () => {
				viewModel.updateSlashCommandSuggestions('/test', 5);

				const state = viewModel.getSnapshot();
				expect(state.isAutoMentionTemporarilyDisabled).toBe(true);
			});

			it('should close dropdown when input does not start with /', () => {
				// First show dropdown
				viewModel.updateSlashCommandSuggestions('/web', 4);

				// Then change input
				viewModel.updateSlashCommandSuggestions('web', 3);

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(false);
			});

			it('should re-enable auto-mention when / is removed', () => {
				// First show slash dropdown (disables auto-mention)
				viewModel.updateSlashCommandSuggestions('/web', 4);
				expect(
					viewModel.getSnapshot().isAutoMentionTemporarilyDisabled
				).toBe(true);

				// Remove /
				viewModel.updateSlashCommandSuggestions('web', 3);

				expect(
					viewModel.getSnapshot().isAutoMentionTemporarilyDisabled
				).toBe(false);
			});

			it('should close dropdown when space is typed', () => {
				viewModel.updateSlashCommandSuggestions('/web ', 5);

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(false);
			});

			it('should keep auto-mention disabled after space', () => {
				viewModel.updateSlashCommandSuggestions('/web ', 5);

				const state = viewModel.getSnapshot();
				expect(state.isAutoMentionTemporarilyDisabled).toBe(true);
			});

			it('should show no suggestions when query matches nothing', () => {
				viewModel.updateSlashCommandSuggestions('/xyz', 4);

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(false);
				expect(state.slashCommandSuggestions).toEqual([]);
			});
		});

		describe('selectSlashCommand', () => {
			it('should return command text with space', () => {
				const command = {
					name: 'web',
					description: 'Search the web',
					hint: 'query',
				};

				const result = viewModel.selectSlashCommand('/w', command);

				expect(result).toBe('/web ');
			});

			it('should close dropdown after selection', () => {
				viewModel.updateSlashCommandSuggestions('/web', 4);

				const command = {
					name: 'web',
					description: 'Search the web',
					hint: 'query',
				};
				viewModel.selectSlashCommand('/web', command);

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(false);
			});
		});

		describe('closeSlashCommandDropdown', () => {
			it('should close dropdown and clear state', () => {
				viewModel.updateSlashCommandSuggestions('/test', 5);

				viewModel.closeSlashCommandDropdown();

				const state = viewModel.getSnapshot();
				expect(state.showSlashCommandDropdown).toBe(false);
				expect(state.slashCommandSuggestions).toEqual([]);
				expect(state.selectedSlashCommandIndex).toBe(0);
			});
		});

		describe('navigateSlashCommandDropdown', () => {
			beforeEach(() => {
				viewModel.updateSlashCommandSuggestions('/', 1);
			});

			it('should navigate down', () => {
				viewModel.navigateSlashCommandDropdown('down');

				expect(viewModel.getSnapshot().selectedSlashCommandIndex).toBe(1);
			});

			it('should not go beyond max index', () => {
				const maxIndex =
					viewModel.getSnapshot().slashCommandSuggestions.length - 1;

				// Navigate beyond max
				for (let i = 0; i < maxIndex + 5; i++) {
					viewModel.navigateSlashCommandDropdown('down');
				}

				expect(viewModel.getSnapshot().selectedSlashCommandIndex).toBe(
					maxIndex
				);
			});

			it('should navigate up', () => {
				viewModel.navigateSlashCommandDropdown('down');
				viewModel.navigateSlashCommandDropdown('down');

				viewModel.navigateSlashCommandDropdown('up');

				expect(viewModel.getSnapshot().selectedSlashCommandIndex).toBe(1);
			});

			it('should not go below 0', () => {
				viewModel.navigateSlashCommandDropdown('up');
				viewModel.navigateSlashCommandDropdown('up');

				expect(viewModel.getSnapshot().selectedSlashCommandIndex).toBe(0);
			});

			it('should do nothing when dropdown not shown', () => {
				viewModel.closeSlashCommandDropdown();

				viewModel.navigateSlashCommandDropdown('down');

				expect(viewModel.getSnapshot().selectedSlashCommandIndex).toBe(0);
			});
		});
	});

	// ========================================
	// Lifecycle Tests
	// ========================================

	describe('Lifecycle', () => {
		it('should dispose and disconnect', async () => {
			viewModel['state'] = {
				...viewModel['state'],
				session: {
					...viewModel['state'].session,
					sessionId: 'test-session',
					state: 'ready',
				},
			};

			vi.mocked(mockManageSessionUseCase.closeSession).mockResolvedValue();
			vi.mocked(mockManageSessionUseCase.disconnect).mockResolvedValue();

			await viewModel.dispose();

			expect(mockManageSessionUseCase.disconnect).toHaveBeenCalled();
			// Listeners should be cleared
			expect(viewModel['listeners'].size).toBe(0);
		});
	});
});
