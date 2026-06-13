import * as React from "react";
const { useState, useRef, useEffect, useCallback, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";

import { setIcon } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { useSettings } from "../hooks/useSettings";

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

interface VaultAdapterWithResourcePath {
	getResourcePath?: (path: string) => string;
}

// ============================================================
// FloatingButtonContainer Class
// ============================================================

/**
 * Container that manages the floating button React component lifecycle.
 * Independent from any floating chat view instance.
 */
export class FloatingButtonContainer {
	private root: Root | null = null;
	private containerEl: HTMLElement;

	constructor(private plugin: AgentClientPlugin) {
		this.containerEl = activeDocument.body.createDiv({
			cls: "agent-client-floating-button-root",
		});
	}

	mount(): void {
		this.root = createRoot(this.containerEl);
		this.root.render(<FloatingButtonComponent plugin={this.plugin} />);
	}

	unmount(): void {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		this.containerEl.remove();
	}
}

// ============================================================
// FloatingButtonComponent
// ============================================================

interface FloatingButtonProps {
	plugin: AgentClientPlugin;
}

function FloatingButtonComponent({ plugin }: FloatingButtonProps) {
	const settings = useSettings(plugin);
	const [hasVisibleChatSurfaces, setHasVisibleChatSurfaces] = useState(() =>
		plugin.hasVisibleChatSurfaces(),
	);

	const BUTTON_SIZE = 48;

	// Dragging state
	const [position, setPosition] = useState<{ x: number; y: number } | null>(
		() => {
			if (!settings.floatingButtonPosition) return null;
			return clampPosition(
				settings.floatingButtonPosition.x,
				settings.floatingButtonPosition.y,
				BUTTON_SIZE,
				BUTTON_SIZE,
			);
		},
	);
	const [isDragging, setIsDragging] = useState(false);
	const dragOffset = useRef({ x: 0, y: 0 });
	const dragStartPos = useRef({ x: 0, y: 0 });
	const wasDragged = useRef(false);

	// Floating button image source
	const floatingButtonImageSrc = useMemo(() => {
		const img = settings.floatingButtonImage;
		if (!img) return null;
		if (
			img.startsWith("http://") ||
			img.startsWith("https://") ||
			img.startsWith("data:")
		) {
			return img;
		}
		return (
			plugin.app.vault.adapter as VaultAdapterWithResourcePath
		).getResourcePath?.(img);
	}, [settings.floatingButtonImage, plugin.app.vault.adapter]);

	// ============================================================
	// Dragging Logic
	// ============================================================
	const DRAG_THRESHOLD = 5;

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			// Compute current position (from state or CSS default)
			const currentX =
				position?.x ?? window.innerWidth - 40 - BUTTON_SIZE;
			const currentY =
				position?.y ?? window.innerHeight - 30 - BUTTON_SIZE;

			setIsDragging(true);
			wasDragged.current = false;
			dragStartPos.current = { x: e.clientX, y: e.clientY };
			dragOffset.current = {
				x: e.clientX - currentX,
				y: e.clientY - currentY,
			};
			e.preventDefault();
		},
		[position],
	);

	useEffect(() => {
		if (!isDragging) return;

		const onMouseMove = (e: MouseEvent) => {
			const dx = e.clientX - dragStartPos.current.x;
			const dy = e.clientY - dragStartPos.current.y;
			if (
				!wasDragged.current &&
				Math.abs(dx) < DRAG_THRESHOLD &&
				Math.abs(dy) < DRAG_THRESHOLD
			) {
				return;
			}
			wasDragged.current = true;
			setPosition(
				clampPosition(
					e.clientX - dragOffset.current.x,
					e.clientY - dragOffset.current.y,
					BUTTON_SIZE,
					BUTTON_SIZE,
				),
			);
		};

		const onMouseUp = () => {
			setIsDragging(false);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [isDragging]);

	// Save button position to settings (debounced)
	useEffect(() => {
		if (!position) return;
		const timer = window.setTimeout(() => {
			if (
				!settings.floatingButtonPosition ||
				position.x !== settings.floatingButtonPosition.x ||
				position.y !== settings.floatingButtonPosition.y
			) {
				void plugin.saveSettingsAndNotify({
					...plugin.settings,
					floatingButtonPosition: position,
				});
			}
		}, 500);
		return () => window.clearTimeout(timer);
	}, [position, plugin, settings.floatingButtonPosition]);

	useEffect(() => {
		const updateActiveChatState = () => {
			setHasVisibleChatSurfaces(plugin.hasVisibleChatSurfaces());
		};

		updateActiveChatState();
		return plugin.onActiveChatsChanged(updateActiveChatState);
	}, [plugin]);

	// Button click handler
	const handleButtonClick = useCallback(() => {
		if (wasDragged.current) return;
		const instances = plugin.getFloatingChatInstances();
		if (instances.length === 0) {
			plugin.openNewFloatingChat(true);
			return;
		}

		const focused = plugin.viewRegistry.getFocused();
		if (focused?.viewType === "floating") {
			plugin.expandFloatingChat(focused.viewId);
			return;
		}

		plugin.expandFloatingChat(instances[instances.length - 1]);
	}, [plugin]);

	if (!settings.enableFloatingChat || hasVisibleChatSurfaces) return null;

	const buttonClassName = [
		"agent-client-floating-button",
		floatingButtonImageSrc ? "has-custom-image" : "",
		isDragging ? "is-dragging" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			className={buttonClassName}
			onMouseDown={handleMouseDown}
			onMouseUp={handleButtonClick}
			style={
				position
					? {
							left: position.x,
							top: position.y,
							right: "auto",
							bottom: "auto",
						}
					: undefined
			}
		>
			{floatingButtonImageSrc ? (
				<img src={floatingButtonImageSrc} alt="Open chat" />
			) : (
				<div
					className="agent-client-floating-button-fallback"
					ref={(el) => {
						if (el) setIcon(el, "bot-message-square");
					}}
				/>
			)}
		</div>
	);
}
