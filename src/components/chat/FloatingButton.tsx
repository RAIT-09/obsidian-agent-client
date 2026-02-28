import * as React from "react";
const { useState, useRef, useEffect, useCallback, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";

import { setIcon } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import { useSettings } from "../../hooks/useSettings";
import { clampPosition } from "../../shared/floating-utils";
import { getUiLanguage, t } from "../../shared/i18n";

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
		this.containerEl = document.body.createDiv({
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
	const language = getUiLanguage(plugin.app);

	const [showInstanceMenu, setShowInstanceMenu] = useState(false);
	const instanceMenuRef = useRef<HTMLDivElement>(null);

	// Button / menu size constants
	const BUTTON_SIZE = 48;
	const MENU_MIN_WIDTH = 220;

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

	// Build display labels with duplicate numbering
	const allInstances = plugin.getFloatingChatInstances();

	const instanceLabels = useMemo(() => {
		const views = plugin.viewRegistry.getByType("floating");
		const entries = views.map((v) => ({
			viewId: v.viewId,
			label: v.getDisplayName(),
		}));
		const countMap = new Map<string, number>();
		for (const e of entries) {
			countMap.set(e.label, (countMap.get(e.label) ?? 0) + 1);
		}
		const indexMap = new Map<string, number>();
		return entries.map((e) => {
			if ((countMap.get(e.label) ?? 0) > 1) {
				const idx = (indexMap.get(e.label) ?? 0) + 1;
				indexMap.set(e.label, idx);
				return {
					viewId: e.viewId,
					label: idx === 1 ? e.label : `${e.label} ${idx}`,
				};
			}
			return e;
		});
	}, [plugin.viewRegistry, allInstances]);

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
		const timer = setTimeout(() => {
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
		return () => clearTimeout(timer);
	}, [position, plugin, settings.floatingButtonPosition]);

	// Button click handler
	const handleButtonClick = useCallback(() => {
		if (wasDragged.current) return;
		const instances = plugin.getFloatingChatInstances();
		if (instances.length === 0) {
			// No instances, create one and expand
			plugin.openNewFloatingChat(true);
		} else if (instances.length === 1) {
			// Single instance, just expand
			plugin.expandFloatingChat(instances[0]);
		} else {
			// Multiple instances, show menu
			setShowInstanceMenu(true);
		}
	}, [plugin]);

	// Close instance menu on outside click
	useEffect(() => {
		if (!showInstanceMenu) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				instanceMenuRef.current &&
				!instanceMenuRef.current.contains(event.target as Node)
			) {
				setShowInstanceMenu(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [showInstanceMenu]);

	if (!settings.showFloatingButton) return null;

	const buttonClassName = [
		"agent-client-floating-button",
		floatingButtonImageSrc ? "has-custom-image" : "",
		isDragging ? "is-dragging" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<>
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
					<img
						src={floatingButtonImageSrc}
						alt={t(language, "openChat")}
					/>
				) : (
					<div
						className="agent-client-floating-button-fallback"
						ref={(el) => {
							if (el) setIcon(el, "bot-message-square");
						}}
					/>
				)}
			</div>
			{showInstanceMenu && (
				<div
					ref={instanceMenuRef}
					className="agent-client-floating-instance-menu"
					style={
						position
							? {
									bottom:
										window.innerHeight - position.y + 10,
									...(position.x + MENU_MIN_WIDTH >
									window.innerWidth
										? {
												right:
													window.innerWidth -
													(position.x + BUTTON_SIZE),
												left: "auto",
												top: "auto",
											}
										: {
												left: position.x,
												right: "auto",
												top: "auto",
											}),
								}
							: undefined
					}
				>
					<div className="agent-client-floating-instance-menu-header">
						{t(language, "selectSessionToOpen")}
					</div>
					{instanceLabels.map(({ viewId: id, label }) => (
						<div
							key={id}
							className="agent-client-floating-instance-menu-item"
							onClick={() => {
								plugin.expandFloatingChat(id);
								plugin.viewRegistry.setFocused(id);
								setShowInstanceMenu(false);
							}}
						>
							<span className="agent-client-floating-instance-menu-label">
								{label}
							</span>
							{instanceLabels.length > 1 && (
								<button
									className="agent-client-floating-instance-menu-close"
									onClick={(e) => {
										e.stopPropagation();
										plugin.closeFloatingChat(id);
										if (instanceLabels.length <= 2) {
											setShowInstanceMenu(false);
										}
									}}
									title={t(language, "closeSession")}
								>
									×
								</button>
							)}
						</div>
					))}
				</div>
			)}
		</>
	);
}
