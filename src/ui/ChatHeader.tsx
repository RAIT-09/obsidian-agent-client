import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon, DropdownComponent } from "obsidian";
import { HeaderButton } from "./shared/IconButton";
import type { AgentDisplayInfo } from "../services/session-helpers";

// ============================================================================
// Props Types
// ============================================================================

/**
 * Props for the sidebar variant of ChatHeader
 */
export interface SidebarHeaderProps {
	variant: "sidebar";
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Whether session history is supported (show History button) */
	hasHistoryCapability?: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to show the header menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
}

/**
 * Props for the floating variant of ChatHeader
 */
export interface FloatingHeaderProps {
	variant: "floating";
	/** Display name of the active agent */
	agentLabel: string;
	/** Available agents for switching */
	availableAgents: AgentDisplayInfo[];
	/** Current agent ID */
	currentAgentId: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Whether there are messages to export */
	hasMessages: boolean;
	/** Callback to switch agent */
	onAgentChange: (agentId: string) => void;
	/** Callback to create a new chat session */
	onNewSession: () => void;
	/** Callback to open session history */
	onOpenHistory: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to restart agent */
	onRestartAgent: () => void;
	/** Callback to open new window (floating only) */
	onOpenNewWindow?: () => void;
	/** Callback to minimize window (floating only) */
	onMinimize?: () => void;
	/** Callback to close and terminate window (floating only) */
	onClose?: () => void;
}

/**
 * Union type for ChatHeader props - dispatches based on variant
 */
export type ChatHeaderProps = SidebarHeaderProps | FloatingHeaderProps;

// ============================================================================
// Internal Components
// ============================================================================

/**
 * A single action button matching Obsidian's nav-action-button pattern.
 * Uses setIcon() to render Lucide icons identically to native sidebar buttons.
 */
function NavActionButton({
	icon,
	label,
	onClick,
}: {
	icon: string;
	label: string;
	onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, icon);
		}
	}, [icon]);

	return (
		<div
			ref={ref}
			className="clickable-icon nav-action-button"
			aria-label={label}
			onClick={onClick}
		/>
	);
}

// ============================================================================
// Sidebar Header
// ============================================================================

/**
 * Header component for the sidebar chat view.
 *
 * Uses Obsidian's native .nav-header + .nav-buttons-container pattern
 * to match the look of File Explorer, Bookmarks, and other sidebar panes.
 */
function SidebarHeader({
	agentLabel,
	isUpdateAvailable,
	hasHistoryCapability = false,
	onNewChat,
	onExportChat,
	onShowMenu,
	onOpenHistory,
}: SidebarHeaderProps) {
	return (
		<div className="nav-header agent-client-chat-view-header">
			<div className="nav-buttons-container">
				<span className="agent-client-chat-view-header-title">
					{agentLabel}
				</span>
				{isUpdateAvailable && (
					<span className="agent-client-chat-view-header-update">
						Plugin update available!
					</span>
				)}
				<NavActionButton
					icon="plus"
					label="New chat"
					onClick={onNewChat}
				/>
				{onOpenHistory && (
					<NavActionButton
						icon="history"
						label="Session history"
						onClick={onOpenHistory}
					/>
				)}
				<NavActionButton
					icon="save"
					label="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<NavActionButton
					icon="more-vertical"
					label="More"
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}

// ============================================================================
// Floating Header
// ============================================================================

/**
 * Inline header component for Floating and CodeBlock chat views.
 *
 * Features:
 * - Agent selector
 * - Update notification (if available)
 * - Action buttons with Lucide icons (new chat, history, export, restart)
 * - Minimize and close buttons (floating variant only)
 */
function FloatingHeader({
	agentLabel,
	availableAgents,
	currentAgentId,
	isUpdateAvailable,
	hasMessages,
	onAgentChange,
	onNewSession,
	onOpenHistory,
	onExportChat,
	onRestartAgent,
	onOpenNewWindow,
	onMinimize,
	onClose,
}: FloatingHeaderProps) {
	// Refs for agent dropdown
	const agentDropdownRef = useRef<HTMLDivElement>(null);
	const agentDropdownInstance = useRef<DropdownComponent | null>(null);

	// Stable ref for onAgentChange callback
	const onAgentChangeRef = useRef(onAgentChange);
	onAgentChangeRef.current = onAgentChange;

	// Initialize agent dropdown
	useEffect(() => {
		const containerEl = agentDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple agents
		if (availableAgents.length <= 1) {
			if (agentDropdownInstance.current) {
				containerEl.empty();
				agentDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!agentDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			agentDropdownInstance.current = dropdown;

			// Add options
			for (const agent of availableAgents) {
				dropdown.addOption(agent.id, agent.displayName);
			}

			// Set initial value
			if (currentAgentId) {
				dropdown.setValue(currentAgentId);
			}

			// Handle change
			dropdown.onChange((value) => {
				onAgentChangeRef.current?.(value);
			});
		}

		// Cleanup on unmount or when availableAgents change
		return () => {
			if (agentDropdownInstance.current) {
				containerEl.empty();
				agentDropdownInstance.current = null;
			}
		};
	}, [availableAgents]);

	// Update dropdown value when currentAgentId changes
	useEffect(() => {
		if (agentDropdownInstance.current && currentAgentId) {
			agentDropdownInstance.current.setValue(currentAgentId);
		}
	}, [currentAgentId]);

	return (
		<div
			className={`agent-client-inline-header agent-client-inline-header-floating`}
		>
			<div className="agent-client-inline-header-main">
				{availableAgents.length > 1 ? (
					<div className="agent-client-agent-selector">
						<div ref={agentDropdownRef} />
						<span
							className="agent-client-agent-selector-icon"
							ref={(el) => {
								if (el) setIcon(el, "chevron-down");
							}}
						/>
					</div>
				) : (
					<span className="agent-client-agent-label">
						{agentLabel}
					</span>
				)}
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					Plugin update available!
				</p>
			)}
			<div className="agent-client-inline-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip="New session"
					onClick={onNewSession}
				/>
				<HeaderButton
					iconName="history"
					tooltip="Session history"
					onClick={onOpenHistory}
				/>
				<HeaderButton
					iconName="save"
					tooltip="Export chat to Markdown"
					onClick={onExportChat}
				/>
				{/* <HeaderButton
					iconName="rotate-cw"
					tooltip="Restart agent"
					onClick={onRestartAgent}
				/> */}
				{onOpenNewWindow && (
					<HeaderButton
						iconName="copy-plus"
						tooltip="Open new floating chat"
						onClick={onOpenNewWindow}
					/>
				)}
				{onMinimize && (
					<HeaderButton
						iconName="minimize-2"
						tooltip="Minimize"
						onClick={onMinimize}
					/>
				)}
				{onClose && (
					<HeaderButton
						iconName="x"
						tooltip="Close"
						onClick={onClose}
					/>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Exported ChatHeader (Dispatcher)
// ============================================================================

/**
 * ChatHeader component that dispatches to SidebarHeader or FloatingHeader
 * based on the `variant` prop.
 */
export function ChatHeader(props: ChatHeaderProps) {
	if (props.variant === "floating") {
		return <FloatingHeader {...props} />;
	}
	return <SidebarHeader {...props} />;
}
