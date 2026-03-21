import { createContext, useContext } from "react";
import type AgentClientPlugin from "../plugin";
import type { AcpAdapter } from "../acp/acp-client";
import type { VaultService } from "../services/vault-service";
import type { SettingsService } from "../services/settings-service";

export interface ChatContextValue {
	plugin: AgentClientPlugin;
	acpClient: AcpAdapter;
	vaultService: VaultService;
	settingsService: SettingsService;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatContextProvider = ChatContext.Provider;

export function useChatContext(): ChatContextValue {
	const ctx = useContext(ChatContext);
	if (!ctx)
		throw new Error(
			"useChatContext must be used within ChatContextProvider",
		);
	return ctx;
}
