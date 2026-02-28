import * as React from "react";
const { useState, useRef, useEffect, useCallback, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";
import { Notice } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type {
	IChatViewContainer,
	ChatViewType,
} from "../../domain/ports/chat-view-container.port";
import type { ChatInputState } from "../../domain/models/chat-input-state";
import type { IChatViewHost } from "./types";
import type { ImagePromptContent } from "../../domain/models/prompt-content";

// Component imports
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { InlineHeader } from "./InlineHeader";

// Hooks imports
import { useChatController } from "../../hooks/useChatController";

import { clampPosition } from "../../shared/floating-utils";
import { tApp } from "../../shared/i18n";

// ============================================================
// Type Definitions
// ============================================================

/**
 * Callbacks for FloatingViewContainer to access React component state.
 * These enable the container to implement IChatViewContainer by delegating
 * to the React component's state and handlers.
 */
interface FloatingViewCallbacks {
	getDisplayName: () => string;
	getInputState: () => ChatInputState | null;
	setInputState: (state: ChatInputState) => void;
	canSend: () => boolean;
	sendMessage: () => Promise<boolean>;
	cancelOperation: () => Promise<void>;
	focus: () => void;
	hasFocus: () => boolean;
	expand: () => void;
	collapse: () => void;
}

/**
 * Tracked listener for cleanup on unmount.
 * Uses union type to match IChatViewHost's overloaded registerDomEvent signatures.
 *
 * Note: options is not tracked because current usage sites do not use options.
 * If future code uses options (e.g., { capture: true }), the cleanup will not
 * work correctly. This is acceptable as current usage does not require options.
 */
interface RegisteredListener {
	target: Window | Document | HTMLElement;
	type: string;
	callback: EventListenerOrEventListenerObject;
}

// ============================================================
// FloatingViewContainer Class
// ============================================================

/**
 * Wrapper class that implements IChatViewContainer for floating chat views.
 * Manages the React component lifecycle and provides the interface for
 * unified view management via ChatViewRegistry.
 */
export class FloatingViewContainer implements IChatViewContainer {
	readonly viewType: ChatViewType = "floating";
	readonly viewId: string;

	private plugin: AgentClientPlugin;
	private root: Root | null = null;
	private containerEl: HTMLElement;
	private callbacks: FloatingViewCallbacks | null = null;

	constructor(plugin: AgentClientPlugin, instanceId: string) {
		this.plugin = plugin;
		// viewId format: "floating-chat-{instanceId}" to match useChatController's adapter key
		this.viewId = `floating-chat-${instanceId}`;
		this.containerEl = document.body.createDiv({
			cls: "agent-client-floating-view-root",
		});
	}

	/**
	 * Mount the React component and register with the plugin.
	 */
	mount(
		initialExpanded: boolean,
		initialPosition?: { x: number; y: number },
	): void {
		this.root = createRoot(this.containerEl);
		this.root.render(
			<FloatingChatComponent
				plugin={this.plugin}
				viewId={this.viewId}
				initialExpanded={initialExpanded}
				initialPosition={initialPosition}
				onRegisterCallbacks={(cbs) => {
					this.callbacks = cbs;
				}}
			/>,
		);

		// Register with plugin's view registry
		this.plugin.viewRegistry.register(this);
	}

	/**
	 * Unmount the React component and unregister from the plugin.
	 */
	unmount(): void {
		this.plugin.viewRegistry.unregister(this.viewId);

		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		this.containerEl.remove();
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	getDisplayName(): string {
		return (
			this.callbacks?.getDisplayName() ??
			tApp(this.plugin.app, "chatDisplayName")
		);
	}

	onActivate(): void {
		this.containerEl.classList.add("is-focused");
	}

	onDeactivate(): void {
		this.containerEl.classList.remove("is-focused");
	}

	focus(): void {
		// Expand if collapsed, then focus
		this.callbacks?.focus();
	}

	hasFocus(): boolean {
		return this.callbacks?.hasFocus() ?? false;
	}

	expand(): void {
		this.callbacks?.expand();
	}

	collapse(): void {
		this.callbacks?.collapse();
	}

	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}
}

// ============================================================
// FloatingChatComponent
// ============================================================

interface FloatingChatComponentProps {
	plugin: AgentClientPlugin;
	viewId: string; // Full viewId passed from FloatingViewContainer
	initialExpanded?: boolean;
	initialPosition?: { x: number; y: number };
	onRegisterCallbacks?: (callbacks: FloatingViewCallbacks) => void;
}

function FloatingChatComponent({
	plugin,
	viewId,
	initialExpanded = false,
	initialPosition,
	onRegisterCallbacks,
}: FloatingChatComponentProps) {
	// ============================================================
	// Chat Controller Hook (Centralized Logic)
	// ============================================================
	const controller = useChatController({
		plugin,
		viewId, // Use viewId prop directly (already in "floating-chat-{id}" format)
		workingDirectory: undefined, // Let hook determine from vault
	});

	const {
		acpAdapter,
		settings,
		session,
		isSessionReady,
		messages,
		isSending,
		isUpdateAvailable,
		permission,
		mentions,
		autoMention,
		slashCommands,
		sessionHistory,
		activeAgentLabel,
		availableAgents,
		errorInfo,
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleClearError,
		handleOpenHistory,
		handleSetMode,
		handleSetModel,
		inputValue,
		setInputValue,
		attachedImages,
		setAttachedImages,
		restoredMessage,
		handleRestoredMessageConsumed,
	} = controller;

	// ============================================================
	// UI State (View-Specific)
	// ============================================================
	const [isExpanded, setIsExpanded] = useState(initialExpanded);
	const [size, setSize] = useState(settings.floatingWindowSize);
	const [position, setPosition] = useState(() => {
		if (initialPosition) {
			return clampPosition(
				initialPosition.x,
				initialPosition.y,
				settings.floatingWindowSize.width,
				settings.floatingWindowSize.height,
			);
		}
		if (settings.floatingWindowPosition) {
			return clampPosition(
				settings.floatingWindowPosition.x,
				settings.floatingWindowPosition.y,
				settings.floatingWindowSize.width,
				settings.floatingWindowSize.height,
			);
		}
		return clampPosition(
			window.innerWidth - settings.floatingWindowSize.width - 50,
			window.innerHeight - settings.floatingWindowSize.height - 50,
			settings.floatingWindowSize.width,
			settings.floatingWindowSize.height,
		);
	});
	const [isDragging, setIsDragging] = useState(false);
	const dragOffset = useRef({ x: 0, y: 0 });
	const containerRef = useRef<HTMLDivElement>(null);

	const acpClientRef = useRef(acpAdapter);

	// Track registered listeners for cleanup
	const registeredListenersRef = useRef<RegisteredListener[]>([]);

	// IChatViewHost implementation with listener tracking
	// Type assertion is used because the implementation handles all overload cases uniformly
	const viewHost: IChatViewHost = useMemo(
		() => ({
			app: plugin.app,
			registerDomEvent: ((
				target: Window | Document | HTMLElement,
				type: string,
				callback: EventListenerOrEventListenerObject,
			) => {
				target.addEventListener(type, callback);
				// Track for cleanup on unmount
				// Note: options is not tracked (see RegisteredListener comment)
				registeredListenersRef.current.push({ target, type, callback });
			}) as IChatViewHost["registerDomEvent"],
		}),
		[plugin.app],
	);

	// Cleanup registered listeners on unmount
	useEffect(() => {
		return () => {
			for (const {
				target,
				type,
				callback,
			} of registeredListenersRef.current) {
				target.removeEventListener(type, callback);
			}
			registeredListenersRef.current = [];
		};
	}, []);

	// Handlers for window management
	const handleOpenNewFloatingChat = useCallback(() => {
		// Open new window with 30px offset from current position, clamped to viewport
		plugin.openNewFloatingChat(
			true,
			clampPosition(
				position.x - 30,
				position.y - 30,
				size.width,
				size.height,
			),
		);
	}, [plugin, position, size.width, size.height]);

	const handleCloseWindow = useCallback(() => {
		setIsExpanded(false);
	}, []);

	// Listen for expand requests
	useEffect(() => {
		const handleExpandRequest = (
			event: CustomEvent<{ viewId: string }>,
		) => {
			if (event.detail.viewId === viewId) {
				setIsExpanded(true);
			}
		};

		window.addEventListener(
			"agent-client:expand-floating-chat" as never,
			handleExpandRequest as EventListener,
		);
		return () => {
			window.removeEventListener(
				"agent-client:expand-floating-chat" as never,
				handleExpandRequest as EventListener,
			);
		};
	}, [viewId]);

	// Sync manual resizing with state
	useEffect(() => {
		if (!isExpanded || !containerRef.current) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				// Only update if significantly different to avoid loops
				if (
					Math.abs(width - size.width) > 5 ||
					Math.abs(height - size.height) > 5
				) {
					setSize({ width, height });
				}
			}
		});

		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [isExpanded, size.width, size.height]);

	// Save size to settings
	useEffect(() => {
		const saveSize = async () => {
			if (
				size.width !== settings.floatingWindowSize.width ||
				size.height !== settings.floatingWindowSize.height
			) {
				await plugin.saveSettingsAndNotify({
					...plugin.settings,
					floatingWindowSize: size,
				});
			}
		};

		const timer = setTimeout(() => {
			void saveSize();
		}, 500); // Debounce save
		return () => clearTimeout(timer);
	}, [size, plugin, settings.floatingWindowSize]);

	// Save position to settings
	useEffect(() => {
		const savePosition = async () => {
			if (
				!settings.floatingWindowPosition ||
				position.x !== settings.floatingWindowPosition.x ||
				position.y !== settings.floatingWindowPosition.y
			) {
				await plugin.saveSettingsAndNotify({
					...plugin.settings,
					floatingWindowPosition: position,
				});
			}
		};

		const timer = setTimeout(() => {
			void savePosition();
		}, 500); // Debounce save
		return () => clearTimeout(timer);
	}, [position, plugin, settings.floatingWindowPosition]);

	// ============================================================
	// Dragging Logic (View-Specific)
	// ============================================================
	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (!containerRef.current) return;
			setIsDragging(true);
			dragOffset.current = {
				x: e.clientX - position.x,
				y: e.clientY - position.y,
			};
		},
		[position],
	);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			setPosition(
				clampPosition(
					e.clientX - dragOffset.current.x,
					e.clientY - dragOffset.current.y,
					size.width,
					size.height,
				),
			);
		};

		const onMouseUp = () => {
			setIsDragging(false);
		};

		if (isDragging) {
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", onMouseUp);
		}

		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [isDragging, size.width, size.height]);

	// ============================================================
	// Callback Registration for IChatViewContainer
	// ============================================================
	// Register callbacks for FloatingViewContainer to access React component state
	// These must match ChatView's sendMessageForBroadcast/canSendForBroadcast functionality
	useEffect(() => {
		if (onRegisterCallbacks) {
			onRegisterCallbacks({
				getDisplayName: () => activeAgentLabel,
				getInputState: () => ({
					text: inputValue,
					images: attachedImages,
				}),
				setInputState: (state) => {
					setInputValue(state.text);
					setAttachedImages(state.images);
				},
				// Match ChatView.canSendForBroadcast exactly
				canSend: () => {
					const hasContent =
						inputValue.trim() !== "" || attachedImages.length > 0;
					return (
						hasContent &&
						isSessionReady &&
						!sessionHistory.loading &&
						!isSending
					);
				},
				// Match ChatView.sendMessageForBroadcast exactly
				sendMessage: async () => {
					// Allow sending if there's text OR images
					if (!inputValue.trim() && attachedImages.length === 0) {
						return false;
					}
					if (!isSessionReady || sessionHistory.loading) {
						return false;
					}
					if (isSending) {
						return false;
					}

					// Convert attached images to ImagePromptContent format
					const imagesToSend: ImagePromptContent[] =
						attachedImages.map((img) => ({
							type: "image",
							data: img.data,
							mimeType: img.mimeType,
						}));

					// Clear input before sending
					const messageToSend = inputValue.trim();
					setInputValue("");
					setAttachedImages([]);

					await handleSendMessage(
						messageToSend,
						imagesToSend.length > 0 ? imagesToSend : undefined,
					);
					return true;
				},
				cancelOperation: handleStopGeneration,
				// Focus with auto-expand
				focus: () => {
					// Expand if collapsed
					if (!isExpanded) {
						setIsExpanded(true);
					}
					// Focus after next render (expansion may need a frame)
					requestAnimationFrame(() => {
						const textarea = containerRef.current?.querySelector(
							"textarea.agent-client-chat-input-textarea",
						);
						if (textarea instanceof HTMLTextAreaElement) {
							textarea.focus();
						}
					});
				},
				hasFocus: () =>
					isExpanded &&
					(containerRef.current?.contains(document.activeElement) ??
						false),
				expand: () => {
					setIsExpanded(true);
				},
				collapse: () => {
					setIsExpanded(false);
				},
			});
		}
	}, [
		onRegisterCallbacks,
		activeAgentLabel,
		inputValue,
		attachedImages,
		isSessionReady,
		isSending,
		sessionHistory.loading,
		isExpanded,
		handleSendMessage,
		handleStopGeneration,
	]);

	// ============================================================
	// Workspace Events (Hotkeys) - same as ChatView.ChatComponent
	// ============================================================

	// 1. Toggle auto-mention
	useEffect(() => {
		const workspace = plugin.app.workspace;
		type CustomEventCallback = (targetViewId?: string) => void;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:toggle-auto-mention", (targetViewId?: string) => {
			if (targetViewId && targetViewId !== viewId) return;
			autoMention.toggle();
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, autoMention.toggle, viewId]);

	// 2. New chat requested (from "New chat with [Agent]" command)
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:new-chat-requested", (agentId?: string) => {
			// Only respond if we are the last active view
			if (
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			void handleNewChat(agentId);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		handleNewChat,
		viewId,
	]);

	// 3. Permission commands
	useEffect(() => {
		const workspace = plugin.app.workspace;
		type CustomEventCallback = (targetViewId?: string) => void;

		const approveRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:approve-active-permission",
			(targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						new Notice(
							tApp(plugin.app, "noActivePermissionRequest"),
						);
					}
				})();
			},
		);

		const rejectRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:reject-active-permission",
			(targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						new Notice(
							tApp(plugin.app, "noActivePermissionRequest"),
						);
					}
				})();
			},
		);

		const cancelRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:cancel-message", (targetViewId?: string) => {
			if (targetViewId && targetViewId !== viewId) return;
			void handleStopGeneration();
		});

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
		handleStopGeneration,
		viewId,
	]);

	// ============================================================
	// Focus Tracking (same as ChatView)
	// ============================================================
	useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = containerRef.current;
		if (!container) return;

		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		// Set as active on mount
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, isExpanded]);

	// ============================================================
	// Render
	// ============================================================
	if (!isExpanded) return null;

	return (
		<div
			ref={containerRef}
			className="agent-client-floating-window"
			style={{
				left: position.x,
				top: position.y,
				width: size.width,
				height: size.height,
			}}
		>
			<div
				className="agent-client-floating-header"
				onMouseDown={onMouseDown}
			>
				<InlineHeader
					plugin={plugin}
					variant="floating"
					agentLabel={activeAgentLabel}
					availableAgents={availableAgents}
					currentAgentId={session.agentId}
					isUpdateAvailable={isUpdateAvailable}
					hasMessages={messages.length > 0}
					onAgentChange={(agentId) => void handleSwitchAgent(agentId)}
					onNewSession={() => void handleNewChat()}
					onOpenHistory={() => void handleOpenHistory()}
					onExportChat={() => void handleExportChat()}
					onRestartAgent={() => void handleRestartAgent()}
					onOpenNewWindow={handleOpenNewFloatingChat}
					onClose={handleCloseWindow}
				/>
			</div>

			<div className="agent-client-floating-content">
				<div className="agent-client-floating-messages-container">
					<ChatMessages
						messages={messages}
						isSending={isSending}
						isSessionReady={isSessionReady}
						isRestoringSession={sessionHistory.loading}
						agentLabel={activeAgentLabel}
						plugin={plugin}
						view={viewHost}
						acpClient={acpClientRef.current}
						onApprovePermission={permission.approvePermission}
					/>
				</div>

				<ChatInput
					isSending={isSending}
					isSessionReady={isSessionReady}
					isRestoringSession={sessionHistory.loading}
					agentLabel={activeAgentLabel}
					availableCommands={session.availableCommands || []}
					autoMentionEnabled={settings.autoMentionActiveNote}
					restoredMessage={restoredMessage}
					mentions={mentions}
					slashCommands={slashCommands}
					autoMention={autoMention}
					plugin={plugin}
					view={viewHost}
					onSendMessage={handleSendMessage}
					onStopGeneration={handleStopGeneration}
					onRestoredMessageConsumed={handleRestoredMessageConsumed}
					modes={session.modes}
					onModeChange={(modeId) => void handleSetMode(modeId)}
					models={session.models}
					onModelChange={(modelId) => void handleSetModel(modelId)}
					supportsImages={session.promptCapabilities?.image ?? false}
					agentId={session.agentId}
					inputValue={inputValue}
					onInputChange={setInputValue}
					attachedImages={attachedImages}
					onAttachedImagesChange={setAttachedImages}
					errorInfo={errorInfo}
					onClearError={handleClearError}
					messages={messages}
				/>
			</div>
		</div>
	);
}
/**
 * Create a new floating chat view.
 * @param plugin - The plugin instance
 * @param instanceId - The instance ID (e.g., "0", "1", "2")
 * @param initialExpanded - Whether to start expanded
 * @returns The FloatingViewContainer instance
 */
export function createFloatingChat(
	plugin: AgentClientPlugin,
	instanceId: string,
	initialExpanded = false,
	initialPosition?: { x: number; y: number },
): FloatingViewContainer {
	const container = new FloatingViewContainer(plugin, instanceId);
	container.mount(initialExpanded, initialPosition);
	return container;
}
