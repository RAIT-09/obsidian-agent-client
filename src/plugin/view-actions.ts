import type { WorkspaceLeaf } from "obsidian";
import type { ChatView } from "../components/chat/ChatView";
import type AgentClientPlugin from "../plugin";
import { createNewChatLeaf, focusChatTextarea } from "./view-helpers";

export async function activateChatView(
	plugin: AgentClientPlugin,
	viewType: string,
): Promise<void> {
	const { workspace } = plugin.app;

	let leaf: WorkspaceLeaf | null = null;
	const leaves = workspace.getLeavesOfType(viewType);

	if (leaves.length > 0) {
		const focusedId = plugin.lastActiveChatViewId;
		if (focusedId) {
			leaf =
				leaves.find((entry) => (entry.view as ChatView)?.viewId === focusedId) ||
				leaves[0];
		} else {
			leaf = leaves[0];
		}
	} else {
		leaf = createNewChatLeaf(
			plugin.app,
			plugin.settings.chatViewLocation,
			false,
			viewType,
		);
		if (leaf) {
			await leaf.setViewState({
				type: viewType,
				active: true,
			});
		}
	}

	if (leaf) {
		await workspace.revealLeaf(leaf);
		focusChatTextarea(leaf);
	}
}

export async function openNewChatViewWithAgent(
	plugin: AgentClientPlugin,
	viewType: string,
	agentId: string,
): Promise<void> {
	const leaf = createNewChatLeaf(
		plugin.app,
		plugin.settings.chatViewLocation,
		true,
		viewType,
	);
	if (!leaf) {
		console.warn("[AgentClient] Failed to create new leaf");
		return;
	}

	await leaf.setViewState({
		type: viewType,
		active: true,
		state: { initialAgentId: agentId },
	});

	await plugin.app.workspace.revealLeaf(leaf);
	focusChatTextarea(leaf, 0);
}
