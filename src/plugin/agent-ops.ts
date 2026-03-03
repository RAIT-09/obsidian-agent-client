import type { AgentClientPluginSettings } from "../plugin";
import type { IChatViewContainer } from "../domain/ports/chat-view-container.port";

export interface AgentSummary {
	id: string;
	displayName: string;
}

export interface AgentOpsHost {
	settings: AgentClientPluginSettings;
	viewRegistry: {
		getAll: () => IChatViewContainer[];
		getFocusedId: () => string | null;
		toFocused: <T>(fn: (view: IChatViewContainer) => T) => T | null;
	};
	addCommand: (config: {
		id: string;
		name: string;
		callback: () => void | Promise<void>;
	}) => void;
	activateView: () => Promise<void>;
	openNewChatViewWithAgent: (agentId: string) => Promise<void>;
	lastActiveChatViewId: string | null;
	app: {
		workspace: {
			trigger: (event: "quit", ...data: unknown[]) => void;
		};
	};
}

export const getAvailableAgents = (
	settings: AgentClientPluginSettings,
): AgentSummary[] => {
	return [
		{
			id: settings.opencode.id,
			displayName: settings.opencode.displayName || settings.opencode.id,
		},
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
};

export const collectAvailableAgentIds = (
	settings: AgentClientPluginSettings,
): string[] => {
	const ids = new Set<string>();
	ids.add(settings.claude.id);
	ids.add(settings.opencode.id);
	ids.add(settings.codex.id);
	ids.add(settings.gemini.id);
	for (const agent of settings.customAgents) {
		if (agent.id && agent.id.length > 0) {
			ids.add(agent.id);
		}
	}
	return Array.from(ids);
};

export const ensureDefaultAgentId = (
	settings: AgentClientPluginSettings,
	fallbackId: string,
): void => {
	const availableIds = collectAvailableAgentIds(settings);
	if (availableIds.length === 0) {
		settings.defaultAgentId = fallbackId;
		return;
	}
	if (!availableIds.includes(settings.defaultAgentId)) {
		settings.defaultAgentId = availableIds[0];
	}
};

export const openChatWithAgent = async (
	host: AgentOpsHost,
	agentId: string,
): Promise<void> => {
	await host.activateView();
	host.app.workspace.trigger("obsius:new-chat-requested" as "quit", agentId);
};

export const registerAgentCommands = (host: AgentOpsHost): void => {
	const agents = getAvailableAgents(host.settings);
	for (const agent of agents) {
		host.addCommand({
			id: `open-chat-with-${agent.id}`,
			name: `New chat with ${agent.displayName}`,
			callback: async () => {
				await openChatWithAgent(host, agent.id);
			},
		});
	}
};

export const registerPermissionCommands = (host: AgentOpsHost): void => {
	host.addCommand({
		id: "approve-active-permission",
		name: "Approve active permission",
		callback: async () => {
			await host.activateView();
			host.app.workspace.trigger(
				"obsius:approve-active-permission" as "quit",
				host.lastActiveChatViewId,
			);
		},
	});

	host.addCommand({
		id: "reject-active-permission",
		name: "Reject active permission",
		callback: async () => {
			await host.activateView();
			host.app.workspace.trigger(
				"obsius:reject-active-permission" as "quit",
				host.lastActiveChatViewId,
			);
		},
	});

	host.addCommand({
		id: "toggle-auto-mention",
		name: "Toggle auto-mention",
		callback: async () => {
			await host.activateView();
			host.app.workspace.trigger(
				"obsius:toggle-auto-mention" as "quit",
				host.lastActiveChatViewId,
			);
		},
	});

	host.addCommand({
		id: "cancel-current-message",
		name: "Cancel current message",
		callback: () => {
			host.app.workspace.trigger(
				"obsius:cancel-message" as "quit",
				host.lastActiveChatViewId,
			);
		},
	});
};
