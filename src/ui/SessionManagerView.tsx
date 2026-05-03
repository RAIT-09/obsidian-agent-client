import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import * as React from "react";
const { useRef, useEffect } = React;
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type { IChatViewContainer } from "../services/view-registry";

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
}: {
	view: IChatViewContainer;
	isFocused: boolean;
	onClick: () => void;
}) {
	const status = view.getSessionStatus();
	const title = view.getSessionTitle();
	const agentName = view.getDisplayName();

	return (
		<div className="tree-item">
			<div
				className={`tree-item-self is-clickable ${isFocused ? "is-active" : ""}`}
				onClick={onClick}
			>
				<SessionStatusIcon status={status} />
				<div className="tree-item-inner agent-client-session-item-text">
					<div className="agent-client-session-item-title">{title}</div>
					<div className="agent-client-session-item-agent">{agentName}</div>
				</div>
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
