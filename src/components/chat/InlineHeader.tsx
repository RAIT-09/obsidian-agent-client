import * as React from "react";
import { useEffect, useRef } from "react";
import { DropdownComponent, setIcon } from "obsidian";
import { HeaderButton } from "./HeaderButton";

// Agent info for display
interface AgentInfo {
	id: string;
	displayName: string;
}

/**
 * Props for InlineHeader component
 */
export interface InlineHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Available agents for switching */
	availableAgents: AgentInfo[];
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
	/** View variant (TODO(code-block): "codeblock" for future code block chat view) */
	variant: "floating" | "codeblock";
	/** Callback to open new window (floating only) */
	onOpenNewWindow?: () => void;
	/** Callback to close window (floating only) */
	onClose?: () => void;
}

/**
 * Inline header component for Floating and CodeBlock chat views.
 *
 * Features:
 * - Agent selector
 * - Update notification (if available)
 * - Action buttons with Lucide icons (new chat, history, export, restart)
 * - Close button (floating variant only)
 */
export function InlineHeader({
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
	variant,
	onOpenNewWindow,
	onClose,
}: InlineHeaderProps) {
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
			className={`agent-client-inline-header agent-client-inline-header-${variant}`}
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
				{variant === "floating" && onOpenNewWindow && (
					<HeaderButton
						iconName="copy-plus"
						tooltip="Open new floating chat"
						onClick={onOpenNewWindow}
					/>
				)}
				{variant === "floating" && onClose && (
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
