import * as React from "react";
const { useState, useRef, useEffect, useCallback, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type {
	IChatViewContainer,
	ChatViewType,
} from "../services/view-registry";
import type { ChatInputState } from "../types/chat";

// Context imports
import { ChatContextProvider } from "./ChatContext";

// Component imports
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";

// Service imports
import { VaultService } from "../services/vault-service";

// Hooks imports
import { useSettings } from "../hooks/useSettings";

// ============================================================
// Helpers
// ============================================================

function clampPosition(
	x: number,
	y: number,
	width: number,
	height: number,
): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(x, window.innerWidth - width)),
		y: Math.max(0, Math.min(y, window.innerHeight - height)),
	};
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
	private callbacks: ChatPanelCallbacks | null = null;
	private isExpandedState = false;
	private containerRefEl: HTMLElement | null = null;

	constructor(plugin: AgentClientPlugin, instanceId: string) {
		this.plugin = plugin;
		// viewId format: "floating-chat-{instanceId}" to match adapter key
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
				onExpandedChange={(expanded) => {
					this.isExpandedState = expanded;
				}}
				onContainerRef={(el) => {
					this.containerRefEl = el;
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
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	onActivate(): void {
		this.containerEl.classList.add("is-focused");
	}

	onDeactivate(): void {
		this.containerEl.classList.remove("is-focused");
	}

	focus(): void {
		// Expand if collapsed, then focus
		if (!this.isExpandedState) {
			// Dispatch expand event
			window.dispatchEvent(
				new CustomEvent("agent-client:expand-floating-chat", {
					detail: { viewId: this.viewId },
				}),
			);
		}
		// Focus after next render (expansion may need a frame)
		requestAnimationFrame(() => {
			const textarea = this.containerRefEl?.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	hasFocus(): boolean {
		return (
			this.isExpandedState &&
			(this.containerRefEl?.contains(document.activeElement) ?? false)
		);
	}

	expand(): void {
		if (!this.isExpandedState) {
			window.dispatchEvent(
				new CustomEvent("agent-client:expand-floating-chat", {
					detail: { viewId: this.viewId },
				}),
			);
		}
	}

	collapse(): void {
		if (this.isExpandedState) {
			window.dispatchEvent(
				new CustomEvent("agent-client:collapse-floating-chat", {
					detail: { viewId: this.viewId },
				}),
			);
		}
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
	viewId: string;
	initialExpanded?: boolean;
	initialPosition?: { x: number; y: number };
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
	onExpandedChange?: (expanded: boolean) => void;
	onContainerRef?: (el: HTMLDivElement | null) => void;
}

function FloatingChatComponent({
	plugin,
	viewId,
	initialExpanded = false,
	initialPosition,
	onRegisterCallbacks,
	onExpandedChange,
	onContainerRef,
}: FloatingChatComponentProps) {
	// ============================================================
	// Services (owned by FloatingViewContainer, created here for context)
	// ============================================================
	const acpClient = useMemo(
		() => plugin.getOrCreateAdapter(viewId),
		[plugin, viewId],
	);

	const vaultService = useMemo(() => new VaultService(plugin), [plugin]);

	// Cleanup VaultService when component unmounts
	useEffect(() => {
		return () => {
			vaultService.destroy();
		};
	}, [vaultService]);

	// ============================================================
	// Context Value
	// ============================================================
	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	// ============================================================
	// UI State (View-Specific)
	// ============================================================
	const settings = useSettings(plugin);
	const [isExpanded, setIsExpanded] = useState(initialExpanded);
	const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
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

	// Expose container element for ChatPanel focus tracking
	useEffect(() => {
		setContainerEl(containerRef.current);
	}, []);

	// Notify parent of expanded state changes
	useEffect(() => {
		onExpandedChange?.(isExpanded);
	}, [isExpanded, onExpandedChange]);

	// Notify parent of container ref
	useEffect(() => {
		onContainerRef?.(containerRef.current);
	}, [onContainerRef, isExpanded]); // re-notify when expanded changes (containerRef may change)

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

	const handleMinimizeWindow = useCallback(() => {
		setIsExpanded(false);
	}, []);

	const handleCloseWindow = useCallback(() => {
		plugin.closeFloatingChat(viewId);
	}, [plugin, viewId]);

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

	// Listen for collapse requests
	useEffect(() => {
		const handleCollapseRequest = (
			event: CustomEvent<{ viewId: string }>,
		) => {
			if (event.detail.viewId === viewId) {
				setIsExpanded(false);
			}
		};

		window.addEventListener(
			"agent-client:collapse-floating-chat" as never,
			handleCollapseRequest as EventListener,
		);
		return () => {
			window.removeEventListener(
				"agent-client:collapse-floating-chat" as never,
				handleCollapseRequest as EventListener,
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
	// Render
	// ============================================================
	return (
		<div
			ref={containerRef}
			className="agent-client-floating-window"
			style={{
				left: position.x,
				top: position.y,
				width: size.width,
				height: size.height,
				display: isExpanded ? undefined : "none",
			}}
		>
			<ChatContextProvider value={contextValue}>
				<ChatPanel
					variant="floating"
					viewId={viewId}
					onRegisterCallbacks={onRegisterCallbacks}
					onMinimize={handleMinimizeWindow}
					onClose={handleCloseWindow}
					onOpenNewWindow={handleOpenNewFloatingChat}
					onFloatingHeaderMouseDown={onMouseDown}
					containerEl={containerEl}
				/>
			</ChatContextProvider>
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
