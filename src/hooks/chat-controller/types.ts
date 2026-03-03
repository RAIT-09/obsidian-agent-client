import type * as React from "react";
import type AgentClientPlugin from "../../plugin";
import type { AttachedImage } from "../../components/chat/ImagePreviewStrip";
import type { ContextUsage } from "../../components/chat/chat-input/ContextUsageMeter";
import type { ImagePromptContent } from "../../domain/models/prompt-content";
import type { SessionModelState } from "../../domain/models/chat-session";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type { IVaultAccess } from "../../domain/ports/vault-access.port";
import { useSettings } from "../useSettings";
import { useMentions } from "../useMentions";
import { useSlashCommands } from "../useSlashCommands";
import { useAutoMention } from "../useAutoMention";
import { useAgentSession } from "../useAgentSession";
import { useChat } from "../useChat";
import { usePermission } from "../usePermission";
import { useSessionHistory } from "../useSessionHistory";
import type { Logger } from "../../shared/logger";
import type { IMentionService } from "../../shared/mention-utils";

export interface AgentInfo {
	id: string;
	displayName: string;
}

export interface UseChatControllerOptions {
	plugin: AgentClientPlugin;
	viewId: string;
	workingDirectory?: string;
	initialAgentId?: string;
	config?: {
		agent?: string;
		model?: string;
	};
}

export interface UseChatControllerReturn {
	logger: Logger;
	vaultPath: string;
	agentClient: IAgentClient;
	vaultAccess: IVaultAccess;
	mentionService: IMentionService;
	settings: ReturnType<typeof useSettings>;
	session: ReturnType<typeof useAgentSession>["session"];
	isSessionReady: boolean;
	messages: ReturnType<typeof useChat>["messages"];
	isSending: boolean;
	isLoadingSessionHistory: boolean;
	permission: ReturnType<typeof usePermission>;
	mentions: ReturnType<typeof useMentions>;
	autoMention: ReturnType<typeof useAutoMention>;
	slashCommands: ReturnType<typeof useSlashCommands>;
	sessionHistory: ReturnType<typeof useSessionHistory>;
	activeAgentLabel: string;
	availableAgents: AgentInfo[];
	errorInfo:
		| ReturnType<typeof useChat>["errorInfo"]
		| ReturnType<typeof useAgentSession>["errorInfo"];
	handleSendMessage: (
		content: string,
		images?: ImagePromptContent[],
	) => Promise<void>;
	handleStopGeneration: () => Promise<void>;
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleSwitchAgent: (agentId: string) => Promise<void>;
	handleRestartAgent: () => Promise<void>;
	handleClearError: () => void;
	handleRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	handleForkSession: (sessionId: string, cwd: string) => Promise<void>;
	handleDeleteSession: (sessionId: string) => void;
	handleLoadMore: () => void;
	handleFetchSessions: (cwd?: string) => void;
	handleOpenHistory: () => void;
	handleCloseHistory: () => void;
	isHistoryPopoverOpen: boolean;
	filteredModels?: SessionModelState;
	handleSetMode: (modeId: string) => Promise<void>;
	handleSetModel: (modelId: string) => Promise<void>;
	inputValue: string;
	setInputValue: React.Dispatch<React.SetStateAction<string>>;
	attachedImages: AttachedImage[];
	setAttachedImages: React.Dispatch<React.SetStateAction<AttachedImage[]>>;
	restoredMessage: string | null;
	handleRestoredMessageConsumed: () => void;
	contextUsage: ContextUsage | null;
}
