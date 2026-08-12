/**
 * Sub-hook for managing chat messages, streaming, and permissions.
 *
 * Handles message state, RAF batching for streaming updates,
 * send/receive operations, and permission approve/reject.
 */

import * as React from "react";
const { useState, useCallback, useMemo, useRef, useEffect } = React;

import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	ImagePromptContent,
	ResourceLinkPromptContent,
	AttachedFile,
	QueuedPrompt,
} from "../types/chat";
import type { ChatSession, SessionUpdate } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { IVaultAccess, NoteMetadata } from "../services/vault-service";
import type { IWikilinkResolver } from "../utils/wikilink-resolver";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import type { IMentionService } from "../utils/mention-parser";
import { preparePrompt, sendPreparedPrompt } from "../services/message-sender";
import { extractErrorMessage } from "../utils/error-utils";
import { Platform } from "obsidian";
import {
	rebuildToolCallIndex,
	applySingleUpdate,
	findActivePermission,
	selectOption,
} from "../services/message-state";
import {
	createQueuedPrompt,
	removeQueuedPromptItem,
	updateQueuedPromptItem,
} from "../services/message-queue";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;
	/** Vault base path for mention resolution */
	vaultBasePath: string;
	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
	/** Attached images (Base64 embedded) */
	images?: ImagePromptContent[];
	/** Attached file references (resource links) */
	resourceLinks?: ResourceLinkPromptContent[];
	/** Whether this is the first message in the session */
	isFirstMessage?: boolean;
	/** Original attachments retained for queue display and editing. */
	attachments?: AttachedFile[];
}

export interface UseAgentMessagesReturn {
	// Message state
	messages: ChatMessage[];
	isSending: boolean;
	lastUserMessage: string | null;
	queuedPrompts: QueuedPrompt[];
	isQueuePaused: boolean;

	// Message operations
	sendMessage: (
		content: string,
		options: SendMessageOptions,
	) => Promise<void>;
	clearMessages: () => void;
	setInitialMessages: (
		history: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	) => void;
	setMessagesFromLocal: (localMessages: ChatMessage[]) => void;
	clearError: () => void;
	setIgnoreUpdates: (ignore: boolean) => void;
	/** Discard any pending RAF updates and reset streaming state (call after stop/cancel). */
	clearPendingUpdates: () => void;
	updateQueuedPrompt: (
		id: string,
		content: string,
		attachments: AttachedFile[],
	) => void;
	removeQueuedPrompt: (id: string) => void;
	resumeQueue: () => void;
	pauseQueue: () => void;

	// Permission
	activePermission: ActivePermission | null;
	hasActivePermission: boolean;
	approvePermission: (requestId: string, optionId: string) => Promise<void>;
	approveActivePermission: () => Promise<boolean>;
	rejectActivePermission: () => Promise<boolean>;

	/** Enqueue a message-level update (used by useAgent for unified handler) */
	enqueueUpdate: (update: SessionUpdate) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAgentMessages(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	vaultAccess: IVaultAccess & IMentionService & IWikilinkResolver,
	session: ChatSession,
	setErrorInfo: (error: ErrorInfo | null) => void,
): UseAgentMessagesReturn {
	// ============================================================
	// Message State
	// ============================================================

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
	const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
	const [isQueuePaused, setIsQueuePaused] = useState(false);
	const [queueDrainVersion, setQueueDrainVersion] = useState(0);
	const isSendingRef = useRef(false);
	const dispatchInProgressRef = useRef(false);
	type QueuedPromptJob = {
		prompt: QueuedPrompt;
		options: SendMessageOptions;
	};
	const queuedPromptJobsRef = useRef<QueuedPromptJob[]>([]);

	// Tool call index: toolCallId → message index for O(1) lookup
	const toolCallIndexRef = useRef<Map<string, number>>(new Map());

	// Ignore updates flag (used during session/load to skip history replay)
	const ignoreUpdatesRef = useRef(false);

	// Generation counter to prevent stale async callbacks from overwriting
	// state after cancel/stop followed by a new send. Each sendMessage()
	// increments this; completion handlers only update state if the
	// generation hasn't changed (fixes Issue #200).
	const generationRef = useRef(0);

	// Track the active ACP prompt separately from prompt preparation so queue
	// draining cannot overlap either phase.
	const sendPromiseRef = useRef<Promise<void> | null>(null);

	const setSending = useCallback((sending: boolean) => {
		isSendingRef.current = sending;
		setIsSending(sending);
	}, []);

	const setQueuePaused = useCallback((paused: boolean) => {
		setIsQueuePaused(paused);
	}, []);

	const clearQueue = useCallback(() => {
		queuedPromptJobsRef.current = [];
		setQueuedPrompts([]);
		setQueuePaused(false);
	}, [setQueuePaused]);

	const pauseQueue = useCallback(() => {
		if (queuedPromptJobsRef.current.length > 0) {
			setQueuePaused(true);
		}
	}, [setQueuePaused]);

	const resumeQueue = useCallback(() => {
		setQueuePaused(false);
	}, [setQueuePaused]);

	const removeQueuedPrompt = useCallback(
		(id: string) => {
			queuedPromptJobsRef.current = queuedPromptJobsRef.current.filter(
				(job) => job.prompt.id !== id,
			);
			setQueuedPrompts((queue) => removeQueuedPromptItem(queue, id));
			if (queuedPromptJobsRef.current.length === 0) {
				setQueuePaused(false);
			}
		},
		[setQueuePaused],
	);

	const updateQueuedPrompt = useCallback(
		(id: string, content: string, attachments: AttachedFile[]) => {
			const job = queuedPromptJobsRef.current.find(
				(candidate) => candidate.prompt.id === id,
			);
			if (!job) return;

			const previousAttachments = job.prompt.attachments;
			const retainedIds = new Set(attachments.map((file) => file.id));
			const previousImages = previousAttachments.filter(
				(file) => file.kind === "image" && Boolean(file.data),
			);
			const previousResources = previousAttachments.filter(
				(file) => file.kind === "file" && Boolean(file.path),
			);

			job.prompt = {
				...job.prompt,
				content,
				attachments: [...attachments],
			};
			job.options = {
				...job.options,
				attachments: [...attachments],
				images: job.options.images?.filter((_image, index) =>
					retainedIds.has(previousImages[index]?.id ?? ""),
				),
				resourceLinks: job.options.resourceLinks?.filter(
					(_link, index) =>
						retainedIds.has(previousResources[index]?.id ?? ""),
				),
			};
			setQueuedPrompts((queue) =>
				updateQueuedPromptItem(queue, id, { content, attachments }),
			);
		},
		[],
	);

	// ============================================================
	// Streaming Update Batching
	// ============================================================

	const pendingUpdatesRef = useRef<SessionUpdate[]>([]);
	const flushScheduledRef = useRef(false);

	const flushPendingUpdates = useCallback(() => {
		flushScheduledRef.current = false;
		const updates = pendingUpdatesRef.current;
		if (updates.length === 0) return;
		pendingUpdatesRef.current = [];

		setMessages((prev) => {
			let result = prev;
			for (const update of updates) {
				result = applySingleUpdate(
					result,
					update,
					toolCallIndexRef.current,
				);
			}
			return result;
		});
	}, []);

	const enqueueUpdate = useCallback(
		(update: SessionUpdate) => {
			if (ignoreUpdatesRef.current) return;
			pendingUpdatesRef.current.push(update);
			if (!flushScheduledRef.current) {
				flushScheduledRef.current = true;
				window.requestAnimationFrame(flushPendingUpdates);
			}
		},
		[flushPendingUpdates],
	);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			pendingUpdatesRef.current = [];
			flushScheduledRef.current = false;
			toolCallIndexRef.current.clear();
			queuedPromptJobsRef.current = [];
		};
	}, []);

	// ============================================================
	// Message Operations
	// ============================================================

	const addMessage = useCallback((message: ChatMessage): void => {
		setMessages((prev) => [...prev, message]);
	}, []);

	const setIgnoreUpdates = useCallback((ignore: boolean): void => {
		ignoreUpdatesRef.current = ignore;
	}, []);

	/**
	 * Cancel-time cleanup. Discards in-flight streaming updates so they don't
	 * bleed into the next reply (#200), but still applies any queued permission
	 * lifecycle updates (cancel/response) so the permission banner clears
	 * instead of staying stuck (#326).
	 */
	const clearPendingUpdates = useCallback((): void => {
		const queued = pendingUpdatesRef.current;
		pendingUpdatesRef.current = [];
		flushScheduledRef.current = false;

		// Streaming deltas are dropped; only terminal permission updates
		// (cancelled or answered) are applied so `findActivePermission` stops
		// returning the request. Active/pending permission updates are not
		// replayed, so a cancel can never re-surface an active banner.
		const permissionUpdates = queued.filter(
			(u) =>
				(u.type === "tool_call" || u.type === "tool_call_update") &&
				(u.permissionRequest?.isCancelled === true ||
					u.permissionRequest?.selectedOptionId !== undefined),
		);
		if (permissionUpdates.length > 0) {
			setMessages((prev) => {
				let result = prev;
				for (const update of permissionUpdates) {
					result = applySingleUpdate(
						result,
						update,
						toolCallIndexRef.current,
					);
				}
				return result;
			});
		}

		pauseQueue();
		setSending(false);
	}, [pauseQueue, setSending]);

	const clearMessages = useCallback((): void => {
		setMessages([]);
		toolCallIndexRef.current.clear();
		setLastUserMessage(null);
		setSending(false);
		clearQueue();
		setErrorInfo(null);
	}, [clearQueue, setErrorInfo, setSending]);

	const setInitialMessages = useCallback(
		(
			history: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp?: string;
			}>,
		): void => {
			const chatMessages: ChatMessage[] = history.map((msg) => ({
				id: crypto.randomUUID(),
				role: msg.role as "user" | "assistant",
				content: msg.content.map((c) => ({
					type: c.type as "text",
					text: c.text,
				})),
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
			}));

			setMessages(chatMessages);
			rebuildToolCallIndex(chatMessages, toolCallIndexRef.current);
			setSending(false);
			clearQueue();
			setErrorInfo(null);
		},
		[clearQueue, setErrorInfo, setSending],
	);

	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			setMessages(localMessages);
			rebuildToolCallIndex(localMessages, toolCallIndexRef.current);
			setSending(false);
			clearQueue();
			setErrorInfo(null);
		},
		[clearQueue, setErrorInfo, setSending],
	);

	const clearError = useCallback((): void => {
		setErrorInfo(null);
	}, [setErrorInfo]);

	const shouldConvertToWsl = useMemo(() => {
		const settings = settingsAccess.getSnapshot();
		return Platform.isWin && settings.windowsWslMode;
	}, [settingsAccess]);

	const dispatchMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			if (!session.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			dispatchInProgressRef.current = true;
			const currentSessionId = session.sessionId;
			const generation = ++generationRef.current;
			const settings = settingsAccess.getSnapshot();
			setSending(true);

			try {
				const prepared = await preparePrompt(
					{
						message: content,
						images: options.images,
						resourceLinks: options.resourceLinks,
						activeNote: options.activeNote,
						vaultBasePath: options.vaultBasePath,
						isAutoMentionDisabled: options.isAutoMentionDisabled,
						convertToWsl: shouldConvertToWsl,
						supportsEmbeddedContext:
							session.promptCapabilities?.embeddedContext ??
							false,
						maxNoteLength: settings.displaySettings.maxNoteLength,
						maxSelectionLength:
							settings.displaySettings.maxSelectionLength,
						isFirstMessage: options.isFirstMessage,
						promptInjection: settings.promptInjection.enabled
							? {
									latex: settings.promptInjection.latex,
									wikiLinks:
										settings.promptInjection.wikiLinks,
									tables: settings.promptInjection.tables,
								}
							: undefined,
						expandWikilinkContext: settings.expandWikilinkContext,
						wikilinkResolver: vaultAccess,
					},
					vaultAccess,
					vaultAccess, // IMentionService (same object)
				);

				const userMessageContent: MessageContent[] = [];

				if (prepared.autoMentionContext) {
					userMessageContent.push({
						type: "text_with_context",
						text: content,
						autoMentionContext: prepared.autoMentionContext,
					});
				} else {
					userMessageContent.push({
						type: "text",
						text: content,
					});
				}

				if (options.images && options.images.length > 0) {
					for (const img of options.images) {
						userMessageContent.push({
							type: "image",
							data: img.data,
							mimeType: img.mimeType,
						});
					}
				}

				if (options.resourceLinks && options.resourceLinks.length > 0) {
					for (const link of options.resourceLinks) {
						userMessageContent.push({
							type: "resource_link",
							uri: link.uri,
							name: link.name,
							mimeType: link.mimeType,
							size: link.size,
						});
					}
				}

				const userMessage: ChatMessage = {
					id: crypto.randomUUID(),
					role: "user",
					content: userMessageContent,
					timestamp: new Date(),
				};
				addMessage(userMessage);
				setLastUserMessage(content);

				const sendPromise = (async () => {
					try {
						const result = await sendPreparedPrompt(
							{
								sessionId: currentSessionId,
								agentContent: prepared.agentContent,
								displayContent: prepared.displayContent,
								authMethods: session.authMethods,
							},
							agentClient,
						);

						if (generationRef.current !== generation) return;

						if (result.success) {
							setSending(false);
							setLastUserMessage(null);
						} else {
							setSending(false);
							pauseQueue();
							setErrorInfo(
								result.error
									? {
											title: result.error.title,
											message: result.error.message,
											suggestion: result.error.suggestion,
										}
									: {
											title: "Send Message Failed",
											message: "Failed to send message",
										},
							);
						}
					} catch (error) {
						if (generationRef.current !== generation) return;
						setSending(false);
						pauseQueue();
						setErrorInfo({
							title: "Send Message Failed",
							message: `Failed to send message: ${extractErrorMessage(error)}`,
						});
					}
				})();

				sendPromiseRef.current = sendPromise;
				await sendPromise;
			} catch (error) {
				if (generationRef.current === generation) {
					setSending(false);
					pauseQueue();
					setErrorInfo({
						title: "Send Message Failed",
						message: `Failed to prepare message: ${extractErrorMessage(error)}`,
					});
				}
			} finally {
				sendPromiseRef.current = null;
				dispatchInProgressRef.current = false;
				setQueueDrainVersion((version) => version + 1);
			}
		},
		[
			agentClient,
			vaultAccess,
			settingsAccess,
			session.sessionId,
			session.authMethods,
			session.promptCapabilities,
			shouldConvertToWsl,
			addMessage,
			setErrorInfo,
			setSending,
			pauseQueue,
		],
	);

	const sendMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			if (!session.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			if (
				isSendingRef.current ||
				dispatchInProgressRef.current ||
				sendPromiseRef.current !== null ||
				queuedPromptJobsRef.current.length > 0
			) {
				const prompt = createQueuedPrompt(content, options.attachments);
				queuedPromptJobsRef.current.push({
					prompt,
					options: { ...options, isFirstMessage: false },
				});
				setQueuedPrompts((queue) => [...queue, prompt]);
				return;
			}

			await dispatchMessage(content, options);
		},
		[dispatchMessage, session.sessionId, setErrorInfo],
	);

	useEffect(() => {
		if (
			isSending ||
			isQueuePaused ||
			dispatchInProgressRef.current ||
			sendPromiseRef.current !== null ||
			queuedPrompts.length === 0 ||
			!session.sessionId
		) {
			return;
		}

		const job = queuedPromptJobsRef.current.shift();
		if (!job) return;
		setQueuedPrompts((queue) =>
			removeQueuedPromptItem(queue, job.prompt.id),
		);
		void dispatchMessage(job.prompt.content, job.options);
	}, [
		dispatchMessage,
		isQueuePaused,
		isSending,
		queuedPrompts.length,
		queueDrainVersion,
		session.sessionId,
	]);

	// ============================================================
	// Permission State & Operations
	// ============================================================

	const activePermission = useMemo(
		() => findActivePermission(messages),
		[messages],
	);

	const hasActivePermission = activePermission !== null;

	const approvePermission = useCallback(
		async (requestId: string, optionId: string): Promise<void> => {
			try {
				await agentClient.respondToPermission(requestId, optionId);
			} catch (error) {
				setErrorInfo({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${extractErrorMessage(error)}`,
				});
			}
		},
		[agentClient, setErrorInfo],
	);

	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(activePermission.options, [
			"allow_once",
			"allow_always",
		]);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0)
			return false;
		const option = selectOption(
			activePermission.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	// ============================================================
	// Return
	// ============================================================

	return {
		messages,
		isSending,
		lastUserMessage,
		queuedPrompts,
		isQueuePaused,
		sendMessage,
		clearMessages,
		setInitialMessages,
		setMessagesFromLocal,
		clearError,
		setIgnoreUpdates,
		clearPendingUpdates,
		updateQueuedPrompt,
		removeQueuedPrompt,
		resumeQueue,
		pauseQueue,
		activePermission,
		hasActivePermission,
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
		enqueueUpdate,
	};
}
