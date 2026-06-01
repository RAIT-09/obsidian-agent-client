import * as React from "react";
const { useRef, useEffect, useMemo } = React;
import { setIcon } from "obsidian";
import { HeaderButton } from "./shared/IconButton";
import type { AgentDisplayInfo } from "../services/session-helpers";
import type AgentClientPlugin from "../plugin";
import {
	AgentAvatar,
	getResolvedAgentAvatarSrc,
} from "./shared/AgentAvatar";
import { ImageSelect, type ImageSelectOption } from "./shared/ImageSelect";

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
	/** Active agent ID */
	agentId: string;
	/** Plugin instance for resolving configured agent images */
	plugin: AgentClientPlugin;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
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
	/** Plugin instance for resolving configured agent images */
	plugin: AgentClientPlugin;
	/** Available agents for switching */
	availableAgents: AgentDisplayInfo[];
	/** Current agent ID */
	currentAgentId: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback to switch agent */
	onAgentChange: (agentId: string) => void;
	/** Callback to show the More menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLElement>) => void;
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

function AgentSelector({
	agentLabel,
	plugin,
	availableAgents,
	currentAgentId,
	onAgentChange,
}: {
	agentLabel: string;
	plugin: AgentClientPlugin;
	availableAgents: AgentDisplayInfo[];
	currentAgentId: string;
	onAgentChange: (agentId: string) => void;
}) {
	const agentOptions = useMemo<ImageSelectOption[]>(
		() =>
			availableAgents.map((agent) => ({
				value: agent.id,
				label: agent.displayName,
				imageSrc: getResolvedAgentAvatarSrc(plugin, agent.id),
			})),
		[availableAgents, plugin],
	);

	if (availableAgents.length > 1) {
		return (
			<div className="agent-client-agent-selector">
				<ImageSelect
					options={agentOptions}
					value={currentAgentId}
					onChange={onAgentChange}
					className="agent-client-agent-image-select"
					placeholder={agentLabel}
				/>
			</div>
		);
	}

	return (
		<span className="agent-client-agent-label">
			<AgentAvatar
				plugin={plugin}
				agentId={currentAgentId}
				className="agent-client-header-agent-avatar"
			/>
			{agentLabel}
		</span>
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
	agentId,
	plugin,
	isUpdateAvailable,
	onNewChat,
	onExportChat,
	onShowMenu,
	onOpenHistory,
}: SidebarHeaderProps) {
	return (
		<div className="nav-header agent-client-chat-view-header">
			<div className="nav-buttons-container">
				<span className="agent-client-chat-view-header-title">
					<AgentAvatar
						plugin={plugin}
						agentId={agentId}
						className="agent-client-header-agent-avatar"
					/>
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
	plugin,
	availableAgents,
	currentAgentId,
	isUpdateAvailable,
	onAgentChange,
	onShowMenu,
	onMinimize,
	onClose,
}: FloatingHeaderProps) {
	return (
		<div
			className={`agent-client-inline-header agent-client-inline-header-floating`}
		>
			<div className="agent-client-inline-header-main">
				<AgentSelector
					agentLabel={agentLabel}
					plugin={plugin}
					availableAgents={availableAgents}
					currentAgentId={currentAgentId}
					onAgentChange={onAgentChange}
				/>
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					Plugin update available!
				</p>
			)}
			<div className="agent-client-inline-header-actions">
				<HeaderButton
					iconName="more-vertical"
					tooltip="More"
					onClick={onShowMenu}
				/>
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
