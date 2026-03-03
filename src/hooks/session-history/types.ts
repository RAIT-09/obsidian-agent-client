import type { ChatMessage } from "../../domain/models/chat-message";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { SessionInfo } from "../../domain/models/session-info";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../../domain/ports/settings-access.port";

export interface SessionLoadCallback {
	(
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
	): void;
}

export interface MessagesRestoreCallback {
	(messages: ChatMessage[]): void;
}

export interface UseSessionHistoryOptions {
	agentClient: IAgentClient;
	session: ChatSession;
	settingsAccess: ISettingsAccess;
	cwd: string;
	onSessionLoad: SessionLoadCallback;
	onMessagesRestore?: MessagesRestoreCallback;
	onLoadStart?: () => void;
	onLoadEnd?: () => void;
}

export interface UseSessionHistoryReturn {
	sessions: SessionInfo[];
	loading: boolean;
	error: string | null;
	hasMore: boolean;
	canShowSessionHistory: boolean;
	canRestore: boolean;
	canFork: boolean;
	canList: boolean;
	isUsingLocalSessions: boolean;
	localSessionIds: Set<string>;
	fetchSessions: (cwd?: string) => Promise<void>;
	loadMoreSessions: () => Promise<void>;
	restoreSession: (sessionId: string, cwd: string) => Promise<void>;
	forkSession: (sessionId: string, cwd: string) => Promise<void>;
	deleteSession: (sessionId: string) => Promise<void>;
	saveSessionLocally: (
		sessionId: string,
		messageContent: string,
	) => Promise<void>;
	saveSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
	invalidateCache: () => void;
}

export interface SessionCache {
	sessions: SessionInfo[];
	nextCursor?: string;
	cwd?: string;
	timestamp: number;
}

export const CACHE_EXPIRY_MS = 5 * 60 * 1000;
