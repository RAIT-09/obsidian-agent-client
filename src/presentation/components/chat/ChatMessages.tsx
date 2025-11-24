/**
 * ChatMessages Component
 *
 * Displays the chat messages list with error state and loading indicator.
 */

import * as React from "react";
const { forwardRef } = React;
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { ChatMessage, ErrorInfo } from "../../../types";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { MessageRenderer } from "./MessageRenderer";

interface ChatMessagesProps {
	/** Chat messages to display */
	messages: ChatMessage[];

	/** Error information to display */
	errorInfo: ErrorInfo | null;

	/** Whether the agent is currently sending/processing */
	isSending: boolean;

	/** Whether the session is ready */
	isSessionReady: boolean;

	/** Active agent display name */
	agentLabel: string;

	/** Plugin instance */
	plugin: AgentClientPlugin;

	/** ACP client for terminal rendering */
	acpClient?: IAcpClient;

	/** Permission use case for handling permissions */
	handlePermissionUseCase: HandlePermissionUseCase;

	/** Callback to clear error */
	onClearError: () => void;
}

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(
	function ChatMessages(
		{
			messages,
			errorInfo,
			isSending,
			isSessionReady,
			agentLabel,
			plugin,
			acpClient,
			handlePermissionUseCase,
			onClearError,
		},
		ref,
	) {
		if (errorInfo) {
			return (
				<div ref={ref} className="chat-view-messages">
					<div className="chat-error-container">
						<h4 className="chat-error-title">{errorInfo.title}</h4>
						<p className="chat-error-message">
							{errorInfo.message}
						</p>
						{errorInfo.suggestion && (
							<p className="chat-error-suggestion">
								{errorInfo.suggestion}
							</p>
						)}
						<button
							onClick={onClearError}
							className="chat-error-button"
						>
							OK
						</button>
					</div>
				</div>
			);
		}

		if (messages.length === 0) {
			return (
				<div ref={ref} className="chat-view-messages">
					<div className="chat-empty-state">
						{!isSessionReady
							? `Connecting to ${agentLabel}...`
							: `Start a conversation with ${agentLabel}...`}
					</div>
				</div>
			);
		}

		return (
			<div ref={ref} className="chat-view-messages">
				{messages.map((message) => (
					<MessageRenderer
						key={message.id}
						message={message}
						plugin={plugin}
						acpClient={acpClient}
						handlePermissionUseCase={handlePermissionUseCase}
					/>
				))}
				{isSending && (
					<div className="loading-indicator">
						<div className="loading-dots">
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
							<div className="loading-dot"></div>
						</div>
					</div>
				)}
			</div>
		);
	},
);
