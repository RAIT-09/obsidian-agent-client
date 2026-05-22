import { ItemView, WorkspaceLeaf, setIcon, Menu } from "obsidian";
import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type {
	IChatViewContainer,
	SessionStatus,
} from "../services/view-registry";
import { addRenameSessionMenuItem } from "./EditTitleModal";
import { useSettings } from "../hooks/useSettings";

export const VIEW_TYPE_SESSION_MANAGER = "agent-client-session-manager";

// ============================================================================
// React Components
// ============================================================================

function SessionStatusIcon({ status }: { status: SessionStatus }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	const iconName = ((s: SessionStatus): string => {
		switch (s) {
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
		}
	})(status);

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

const SessionItem = React.memo(function SessionItem({
	view,
	isFocused,
	plugin,
	status,
	title,
	agentName,
}: {
	view: IChatViewContainer;
	isFocused: boolean;
	plugin: AgentClientPlugin;
	status: SessionStatus;
	title: string;
	agentName: string;
}) {
	const moreRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (moreRef.current) setIcon(moreRef.current, "more-horizontal");
	}, []);

	// `view` is stable for the same viewId (registry holds the same instance),
	// so this callback is stable across renders — keeping React.memo effective.
	const handleClick = useCallback(() => view.focus(), [view]);

	const showMenu = useCallback(
		(position: { x: number; y: number }) => {
			const menu = new Menu();

			addRenameSessionMenuItem(
				menu,
				plugin,
				view.getSessionId(),
				view.getSessionTitle(),
				{ label: "Rename" },
			);

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
				onClick={handleClick}
				onContextMenu={handleContextMenu}
			>
				<SessionStatusIcon status={status} />
				<div className="tree-item-inner agent-client-session-item-text">
					<div className="agent-client-session-item-title">{title}</div>
					<div className="agent-client-session-item-agent">{agentName}</div>
				</div>
				<button
					ref={moreRef}
					type="button"
					className="agent-client-session-item-more clickable-icon"
					aria-label="Session actions"
					onClick={handleMoreClick}
				/>
			</div>
		</div>
	);
});

function SessionManagerComponent({
	plugin,
}: {
	plugin: AgentClientPlugin;
}) {
	const { views, focusedId } = useSyncExternalStore(
		plugin.viewRegistry.subscribe,
		plugin.viewRegistry.getSnapshot,
		plugin.viewRegistry.getSnapshot,
	);

	// Subscribe to settings changes so renamed titles are reflected immediately
	useSettings(plugin);

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
					plugin={plugin}
					status={view.getSessionStatus()}
					title={view.getSessionTitle()}
					agentName={view.getDisplayName()}
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
