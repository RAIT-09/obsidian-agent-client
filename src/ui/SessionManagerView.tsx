import { ItemView, WorkspaceLeaf, setIcon, Menu } from "obsidian";
import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type { IChatViewContainer } from "../services/view-registry";
import { EditTitleModal } from "./EditTitleModal";

export const VIEW_TYPE_SESSION_MANAGER = "agent-client-session-manager";

// ============================================================================
// React Components
// ============================================================================

function SessionStatusIcon({ status }: { status: string }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	const iconName = (() => {
		switch (status) {
			case "ready":
				return "circle-check";
			case "busy":
				return "loader";
			case "permission":
				return "shield-alert";
			case "error":
				return "circle-x";
			case "disconnected":
				return "circle-off";
			default:
				return "circle";
		}
	})();

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, iconName);
	}, [iconName]);

	return (
		<span
			ref={iconRef}
			className={`agent-client-session-status-icon agent-client-session-status-${status}`}
		/>
	);
}

function SessionItem({
	view,
	isFocused,
	onClick,
	plugin,
}: {
	view: IChatViewContainer;
	isFocused: boolean;
	onClick: () => void;
	plugin: AgentClientPlugin;
}) {
	const status = view.getSessionStatus();
	const title = view.getSessionTitle();
	const agentName = view.getDisplayName();
	const moreRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (moreRef.current) setIcon(moreRef.current, "more-horizontal");
	}, []);

	const showMenu = useCallback(
		(position: { x: number; y: number }) => {
			const menu = new Menu();

			const sessionId = view.getSessionId();
			const hasSavedSession = sessionId
				? plugin.settingsService
						.getSavedSessions()
						.some((s) => s.sessionId === sessionId)
				: false;

			menu.addItem((item) => {
				item.setTitle("Rename")
					.setIcon("pencil")
					.setDisabled(!hasSavedSession)
					.onClick(() => {
						if (!sessionId || !hasSavedSession) return;
						const currentTitle = view.getSessionTitle();
						const modal = new EditTitleModal(
							plugin.app,
							currentTitle,
							async (newTitle) => {
								view.setSessionTitle(newTitle);
								await plugin.settingsService.updateSessionTitle(
									sessionId,
									newTitle,
								);
							},
						);
						modal.open();
					});
			});

			menu.addItem((item) => {
				item.setTitle("Close")
					.setIcon("x")
					.onClick(() => {
						plugin.closeView(view.viewId);
					});
			});

			menu.showAtPosition(position);
		},
		[plugin, view],
	);

	const handleMoreClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			showMenu({ x: e.clientX, y: e.clientY });
		},
		[showMenu],
	);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			showMenu({ x: e.clientX, y: e.clientY });
		},
		[showMenu],
	);

	return (
		<div className="tree-item">
			<div
				className={`tree-item-self is-clickable ${isFocused ? "is-active" : ""}`}
				onClick={onClick}
				onContextMenu={handleContextMenu}
			>
				<SessionStatusIcon status={status} />
				<div className="tree-item-inner agent-client-session-item-text">
					<div className="agent-client-session-item-title">{title}</div>
					<div className="agent-client-session-item-agent">{agentName}</div>
				</div>
				<div
					ref={moreRef}
					className="agent-client-session-item-more"
					onClick={handleMoreClick}
				/>
			</div>
		</div>
	);
}

function SessionManagerComponent({
	plugin,
}: {
	plugin: AgentClientPlugin;
}) {
	const views = useSyncExternalStore(
		plugin.viewRegistry.subscribe,
		plugin.viewRegistry.getSnapshot,
		plugin.viewRegistry.getSnapshot,
	);

	const focusedId = plugin.viewRegistry.getFocusedId();

	if (views.length === 0) {
		return (
			<div className="agent-client-session-manager-empty">
				No active sessions
			</div>
		);
	}

	return (
		<div className="agent-client-session-manager">
			{views.map((view) => (
				<SessionItem
					key={view.viewId}
					view={view}
					isFocused={view.viewId === focusedId}
					onClick={() => view.focus()}
					plugin={plugin}
				/>
			))}
		</div>
	);
}

// ============================================================================
// Obsidian ItemView
// ============================================================================

export class SessionManagerView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType() {
		return VIEW_TYPE_SESSION_MANAGER;
	}

	getDisplayText() {
		return "Agent sessions";
	}

	getIcon() {
		return "layout-list";
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		this.root = createRoot(container);
		this.root.render(
			<SessionManagerComponent plugin={this.plugin} />,
		);
		return Promise.resolve();
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
