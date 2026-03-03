import type { AcpError } from "../../../domain/models/agent-error";
import type { NoteMetadata } from "../../../domain/ports/vault-access.port";
import type { AuthenticationMethod } from "../../../domain/models/chat-session";
import type {
	PromptContent,
	ImagePromptContent,
} from "../../../domain/models/prompt-content";

export interface PreparePromptInput {
	message: string;
	images?: ImagePromptContent[];
	activeNote?: NoteMetadata | null;
	vaultBasePath: string;
	isAutoMentionDisabled?: boolean;
	convertToWsl?: boolean;
	supportsEmbeddedContext?: boolean;
	supportsImage?: boolean;
	maxNoteLength?: number;
	maxSelectionLength?: number;
}

export interface PreparePromptResult {
	displayContent: PromptContent[];
	agentContent: PromptContent[];
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

export interface SendPreparedPromptInput {
	sessionId: string;
	agentContent: PromptContent[];
	displayContent: PromptContent[];
	authMethods: AuthenticationMethod[];
}

export interface SendPromptResult {
	success: boolean;
	displayContent: PromptContent[];
	agentContent: PromptContent[];
	error?: AcpError;
	requiresAuth?: boolean;
	retriedSuccessfully?: boolean;
}

export const DEFAULT_MAX_NOTE_LENGTH = 10000;
export const DEFAULT_MAX_SELECTION_LENGTH = 10000;
