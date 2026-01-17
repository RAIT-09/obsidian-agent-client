import * as React from "react";
import * as ReactDOM from "react-dom";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";

interface AgentInfo {
	id: string;
	displayName: string;
}

export interface HeaderMenuProps {
	/** Reference element for positioning */
	anchorRef: React.RefObject<HTMLButtonElement | null>;
	/** Current agent ID for this view */
	currentAgentId: string;
	/** List of available agents */
	availableAgents: AgentInfo[];
	/** Callback when agent is switched */
	onSwitchAgent: (agentId: string) => void;
	/** Callback to open a new view with default agent */
	onOpenNewView: () => void;
	/** Callback to open plugin settings */
	onOpenPluginSettings: () => void;
	/** Callback to close the menu */
	onClose: () => void;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: ChatView;
}

export function HeaderMenu({
	anchorRef,
	currentAgentId,
	availableAgents,
	onSwitchAgent,
	onOpenNewView,
	onOpenPluginSettings,
	onClose,
}: HeaderMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	// Icons refs
	const newViewIconRef = useRef<HTMLSpanElement>(null);
	const settingsIconRef = useRef<HTMLSpanElement>(null);

	// Set icons
	useEffect(() => {
		if (newViewIconRef.current) {
			setIcon(newViewIconRef.current, "plus");
		}
		if (settingsIconRef.current) {
			setIcon(settingsIconRef.current, "settings");
		}
	}, []);

	// Outside click to close
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(event.target as Node) &&
				anchorRef.current &&
				!anchorRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [onClose, anchorRef]);

	// Keyboard navigation - Escape to close
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
				event.preventDefault();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Position calculation - computed on every render since anchor position may change
	const menuStyle = (() => {
		if (!anchorRef.current) return {};
		const rect = anchorRef.current.getBoundingClientRect();
		const topPosition = rect.bottom + 4;
		const availableHeight = window.innerHeight - topPosition - 16; // 16px margin from bottom

		return {
			position: "fixed" as const,
			top: topPosition,
			right: window.innerWidth - rect.right,
			maxHeight: Math.max(availableHeight, 100), // Ensure minimum height
			overflowY: "auto" as const,
		};
	})();

	// Use portal to render menu at document.body level
	// This avoids CSS containment issues in Obsidian's view containers
	return ReactDOM.createPortal(
		<div
			ref={menuRef}
			className="agent-client-header-menu"
			style={menuStyle}
		>
			{/* Switch Agent Header */}
			<div className="agent-client-header-menu-header">Switch agent</div>

			{/* Agent List */}
			{availableAgents.map((agent) => (
				<div
					key={agent.id}
					className={`agent-client-header-menu-item ${
						agent.id === currentAgentId
							? "agent-client-current"
							: ""
					}`}
					onClick={() => {
						onSwitchAgent(agent.id);
						onClose();
					}}
				>
					<span className="agent-client-header-menu-icon" />
					<span>{agent.displayName}</span>
					{agent.id === currentAgentId && (
						<span className="agent-client-header-menu-check">
							✓
						</span>
					)}
				</div>
			))}

			<div className="agent-client-header-menu-separator" />

			{/* Open New View */}
			<div
				className="agent-client-header-menu-item"
				onClick={() => {
					onOpenNewView();
					onClose();
				}}
			>
				<span
					ref={newViewIconRef}
					className="agent-client-header-menu-icon"
				/>
				<span>Open new view</span>
			</div>

			<div className="agent-client-header-menu-separator" />

			{/* Plugin Settings */}
			<div
				className="agent-client-header-menu-item"
				onClick={() => {
					onOpenPluginSettings();
					onClose();
				}}
			>
				<span
					ref={settingsIconRef}
					className="agent-client-header-menu-icon"
				/>
				<span>Plugin settings</span>
			</div>
		</div>,
		document.body,
	);
}
