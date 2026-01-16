import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { setIcon } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";

interface AgentInfo {
	id: string;
	displayName: string;
}

export interface SettingsMenuProps {
	/** Reference element for positioning */
	anchorRef: React.RefObject<HTMLButtonElement | null>;
	/** Current agent ID for this view */
	currentAgentId: string;
	/** List of available agents */
	availableAgents: AgentInfo[];
	/** Callback when agent is switched */
	onSwitchAgent: (agentId: string) => void;
	/** Callback to open a new view with specific agent */
	onOpenNewView: (agentId: string) => void;
	/** Callback to open plugin settings */
	onOpenPluginSettings: () => void;
	/** Callback to close the menu */
	onClose: () => void;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: ChatView;
}

type MenuState = "main" | "switch-agent" | "new-view";

export function SettingsMenu({
	anchorRef,
	currentAgentId,
	availableAgents,
	onSwitchAgent,
	onOpenNewView,
	onOpenPluginSettings,
	onClose,
	plugin,
	view,
}: SettingsMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuState, setMenuState] = useState<MenuState>("main");
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Icons refs for setting icons
	const switchIconRef = useRef<HTMLSpanElement>(null);
	const newViewIconRef = useRef<HTMLSpanElement>(null);
	const settingsIconRef = useRef<HTMLSpanElement>(null);
	const backIconRef = useRef<HTMLSpanElement>(null);

	// Set icons
	useEffect(() => {
		if (switchIconRef.current) {
			setIcon(switchIconRef.current, "replace");
		}
		if (newViewIconRef.current) {
			setIcon(newViewIconRef.current, "plus");
		}
		if (settingsIconRef.current) {
			setIcon(settingsIconRef.current, "settings");
		}
	}, [menuState]);

	useEffect(() => {
		if (backIconRef.current) {
			setIcon(backIconRef.current, "arrow-left");
		}
	}, [menuState]);

	// Get current items based on menu state
	const currentItems = useMemo(() => {
		if (menuState === "main") {
			return ["switch-agent", "new-view", "separator", "plugin-settings"];
		}
		return availableAgents.map((agent) => agent.id);
	}, [menuState, availableAgents]);

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

	// Keyboard navigation
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (menuState === "main") {
					onClose();
				} else {
					setMenuState("main");
					setSelectedIndex(0);
				}
				event.preventDefault();
			} else if (event.key === "ArrowDown") {
				const selectableItems = currentItems.filter(
					(item) => item !== "separator",
				);
				setSelectedIndex((prev) =>
					Math.min(prev + 1, selectableItems.length - 1),
				);
				event.preventDefault();
			} else if (event.key === "ArrowUp") {
				setSelectedIndex((prev) => Math.max(0, prev - 1));
				event.preventDefault();
			} else if (event.key === "Enter") {
				handleEnter();
				event.preventDefault();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [menuState, selectedIndex, currentItems, onClose]);

	const handleEnter = useCallback(() => {
		if (menuState === "main") {
			const selectableItems = currentItems.filter(
				(item) => item !== "separator",
			);
			const item = selectableItems[selectedIndex];
			if (item === "switch-agent") {
				setMenuState("switch-agent");
				setSelectedIndex(0);
			} else if (item === "new-view") {
				setMenuState("new-view");
				setSelectedIndex(0);
			} else if (item === "plugin-settings") {
				onOpenPluginSettings();
				onClose();
			}
		} else {
			const agentId = availableAgents[selectedIndex]?.id;
			if (agentId) {
				if (menuState === "switch-agent") {
					onSwitchAgent(agentId);
				} else {
					onOpenNewView(agentId);
				}
				onClose();
			}
		}
	}, [
		menuState,
		selectedIndex,
		currentItems,
		availableAgents,
		onSwitchAgent,
		onOpenNewView,
		onOpenPluginSettings,
		onClose,
	]);

	// Position calculation
	const menuStyle = useMemo(() => {
		if (!anchorRef.current) return {};
		const rect = anchorRef.current.getBoundingClientRect();
		return {
			position: "fixed" as const,
			top: rect.bottom + 4,
			right: window.innerWidth - rect.right,
		};
	}, [anchorRef]);

	const renderMainMenu = () => {
		let selectableIndex = 0;

		return (
			<>
				<div
					className={`agent-client-settings-menu-item agent-client-settings-menu-item-submenu ${
						selectedIndex === selectableIndex++
							? "agent-client-selected"
							: ""
					}`}
					onClick={() => {
						setMenuState("switch-agent");
						setSelectedIndex(0);
					}}
				>
					<span
						ref={switchIconRef}
						className="agent-client-settings-menu-icon"
					/>
					<span>Switch Agent</span>
					<span className="agent-client-settings-menu-arrow">›</span>
				</div>
				<div
					className={`agent-client-settings-menu-item agent-client-settings-menu-item-submenu ${
						selectedIndex === selectableIndex++
							? "agent-client-selected"
							: ""
					}`}
					onClick={() => {
						setMenuState("new-view");
						setSelectedIndex(0);
					}}
				>
					<span
						ref={newViewIconRef}
						className="agent-client-settings-menu-icon"
					/>
					<span>Open New View</span>
					<span className="agent-client-settings-menu-arrow">›</span>
				</div>
				<div className="agent-client-settings-menu-separator" />
				<div
					className={`agent-client-settings-menu-item ${
						selectedIndex === selectableIndex
							? "agent-client-selected"
							: ""
					}`}
					onClick={() => {
						onOpenPluginSettings();
						onClose();
					}}
				>
					<span
						ref={settingsIconRef}
						className="agent-client-settings-menu-icon"
					/>
					<span>Plugin Settings</span>
				</div>
			</>
		);
	};

	const renderAgentList = (onSelectAgent: (agentId: string) => void) => (
		<>
			<div
				className="agent-client-settings-menu-back"
				onClick={() => {
					setMenuState("main");
					setSelectedIndex(0);
				}}
			>
				<span
					ref={backIconRef}
					className="agent-client-settings-menu-icon"
				/>
				<span>Back</span>
			</div>
			<div className="agent-client-settings-menu-separator" />
			{availableAgents.map((agent, index) => (
				<div
					key={agent.id}
					className={`agent-client-settings-menu-item ${
						agent.id === currentAgentId
							? "agent-client-current"
							: ""
					} ${selectedIndex === index ? "agent-client-selected" : ""}`}
					onClick={() => {
						onSelectAgent(agent.id);
						onClose();
					}}
				>
					<span className="agent-client-settings-menu-icon" />
					<span>{agent.displayName}</span>
					{agent.id === currentAgentId && (
						<span className="agent-client-settings-menu-check">
							✓
						</span>
					)}
				</div>
			))}
		</>
	);

	return (
		<div
			ref={menuRef}
			className="agent-client-settings-menu"
			style={menuStyle}
		>
			{menuState === "main" && renderMainMenu()}
			{menuState === "switch-agent" &&
				renderAgentList((agentId) => onSwitchAgent(agentId))}
			{menuState === "new-view" &&
				renderAgentList((agentId) => onOpenNewView(agentId))}
		</div>
	);
}
