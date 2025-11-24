/**
 * ChatView
 *
 * Obsidian ItemView wrapper for the chat interface.
 * Delegates all React rendering to ChatViewComponent.
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { EventRef } from "obsidian";
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import { Logger } from "../../../utils/logger";
import { ChatViewWrapper } from "./ChatViewComponent";
import type { ChatBridge } from "./ChatBridge";

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	public chatBridge: ChatBridge | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = new Logger(plugin);
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Agent client";
	}

	getIcon() {
		return "bot-message-square";
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatViewWrapper plugin={this.plugin} view={this} />);
		this.registerPermissionEvents();
		return Promise.resolve();
	}

	async onClose() {
		this.logger.log("[ChatView] onClose() called");
		if (this.chatBridge) {
			this.logger.log("[ChatView] Disposing via ChatBridge...");
			await this.chatBridge.dispose();
			this.chatBridge = null;
		}
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}

	private registerPermissionEvents(): void {
		const approveHandler = async () => {
			if (!this.chatBridge) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const success = await this.chatBridge.approveActivePermission();
			if (!success) {
				new Notice("[Agent Client] No active permission request");
			}
		};

		const rejectHandler = async () => {
			if (!this.chatBridge) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const success = await this.chatBridge.rejectActivePermission();
			if (!success) {
				new Notice("[Agent Client] No active permission request");
			}
		};

		const toggleAutoMentionHandler = () => {
			if (!this.chatBridge) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const currentState = this.chatBridge.getIsAutoMentionDisabled();
			this.chatBridge.toggleAutoMention(!currentState);
		};

		const workspace = this.app.workspace as unknown as {
			on: (event: string, callback: () => void) => EventRef;
		};

		this.registerEvent(
			workspace.on("agent-client:approve-active-permission", () => {
				void approveHandler();
			}),
		);
		this.registerEvent(
			workspace.on("agent-client:reject-active-permission", () => {
				void rejectHandler();
			}),
		);
		this.registerEvent(
			workspace.on("agent-client:toggle-auto-mention", () => {
				toggleAutoMentionHandler();
			}),
		);
	}
}
