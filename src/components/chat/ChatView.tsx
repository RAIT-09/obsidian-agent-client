import {
	ItemView,
	type WorkspaceLeaf,
	type IconName,
} from "obsidian";
import type {
	ChatViewType,
	ChatViewContextReference,
	IChatViewContainer,
} from "../../domain/ports/chat-view-container.port";
import { createRoot, type Root } from "react-dom/client";
import type { ChatInputState } from "../../domain/models/chat-input-state";
import type AgentClientPlugin from "../../plugin";
import { getLogger, type Logger } from "../../shared/logger";
import { ChatViewComponent } from "./ChatViewComponent";

export const VIEW_TYPE_CHAT = "obsius-chat-view";

// ============================================================
// ChatView (Obsidian ItemView)
// ============================================================

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

type GetDisplayNameCallback = () => string;
type GetInputStateCallback = () => ChatInputState | null;
type SetInputStateCallback = (state: ChatInputState) => void;
type SendMessageCallback = () => Promise<boolean>;
type CanSendCallback = () => boolean;
type CancelCallback = () => Promise<void>;
type AddContextReferenceCallback = (
	reference: ChatViewContextReference,
) => boolean;
type GetLastAssistantTextCallback = () => string | null;

export class ChatView extends ItemView implements IChatViewContainer {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	readonly viewId: string;
	readonly viewType: ChatViewType = "sidebar";
	private initialAgentId: string | null = null;
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> = new Set();
	private tabAdapterIds: Set<string> = new Set();

	private getDisplayNameCallback: GetDisplayNameCallback | null = null;
	private getInputStateCallback: GetInputStateCallback | null = null;
	private setInputStateCallback: SetInputStateCallback | null = null;
	private sendMessageCallback: SendMessageCallback | null = null;
	private canSendCallback: CanSendCallback | null = null;
	private cancelCallback: CancelCallback | null = null;
	private addContextReferenceCallback: AddContextReferenceCallback | null =
		null;
	private getLastAssistantTextCallback: GetLastAssistantTextCallback | null =
		null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = getLogger();
		this.viewId = (leaf as { id?: string }).id ?? crypto.randomUUID();
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Obsius";
	}

	getIcon() {
		return "obsius-o" as IconName;
	}

	getState(): ChatViewState {
		return {
			initialAgentId: this.initialAgentId ?? undefined,
		};
	}

	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		const previousAgentId = this.initialAgentId;
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);

		const restoredId = this.initialAgentId;
		if (restoredId && restoredId !== previousAgentId) {
			for (const cb of this.agentIdRestoredCallbacks) {
				cb(restoredId);
			}
		}
	}

	getInitialAgentId(): string | null {
		return this.initialAgentId;
	}

	setAgentId(agentId: string): void {
		this.initialAgentId = agentId;
		this.app.workspace.requestSaveLayout();
	}

	onAgentIdRestored(callback: (agentId: string) => void): () => void {
		this.agentIdRestoredCallbacks.add(callback);
		return () => {
			this.agentIdRestoredCallbacks.delete(callback);
		};
	}

	registerTabAdapter(tabId: string): void {
		this.tabAdapterIds.add(tabId);
	}

	unregisterTabAdapter(tabId: string): void {
		this.tabAdapterIds.delete(tabId);
	}

	registerInputCallbacks(callbacks: {
		getDisplayName: GetDisplayNameCallback;
		getInputState: GetInputStateCallback;
		setInputState: SetInputStateCallback;
		sendMessage: SendMessageCallback;
		canSend: CanSendCallback;
		cancel: CancelCallback;
		addContextReference: AddContextReferenceCallback;
		getLastAssistantText: GetLastAssistantTextCallback;
	}): void {
		this.getDisplayNameCallback = callbacks.getDisplayName;
		this.getInputStateCallback = callbacks.getInputState;
		this.setInputStateCallback = callbacks.setInputState;
		this.sendMessageCallback = callbacks.sendMessage;
		this.canSendCallback = callbacks.canSend;
		this.cancelCallback = callbacks.cancel;
		this.addContextReferenceCallback = callbacks.addContextReference;
		this.getLastAssistantTextCallback = callbacks.getLastAssistantText;
	}

	unregisterInputCallbacks(): void {
		this.getDisplayNameCallback = null;
		this.getInputStateCallback = null;
		this.setInputStateCallback = null;
		this.sendMessageCallback = null;
		this.canSendCallback = null;
		this.cancelCallback = null;
		this.addContextReferenceCallback = null;
		this.getLastAssistantTextCallback = null;
	}

	getDisplayName(): string {
		return this.getDisplayNameCallback?.() ?? "Chat";
	}

	getInputState(): ChatInputState | null {
		return this.getInputStateCallback?.() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.setInputStateCallback?.(state);
	}

	async sendMessage(): Promise<boolean> {
		return (await this.sendMessageCallback?.()) ?? false;
	}

	canSend(): boolean {
		return this.canSendCallback?.() ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.cancelCallback?.();
	}

	getLastAssistantText(): string | null {
		return this.getLastAssistantTextCallback?.() ?? null;
	}

	addContextReference(reference: ChatViewContextReference): boolean {
		return this.addContextReferenceCallback?.(reference) ?? false;
	}

	onActivate(): void {
		this.logger.log(`[ChatView] Activated: ${this.viewId}`);
	}

	onDeactivate(): void {
		this.logger.log(`[ChatView] Deactivated: ${this.viewId}`);
	}

	focus(): void {
		void this.app.workspace.revealLeaf(this.leaf).then(() => {
			const textarea = this.containerEl.querySelector(
				"textarea.obsius-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	hasFocus(): boolean {
		return this.containerEl.contains(document.activeElement);
	}

	expand(): void {
		// Sidebar views don't have expand/collapse state
	}

	collapse(): void {
		// Sidebar views don't have expand/collapse state
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(
			<ChatViewComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);

		this.plugin.viewRegistry.register(this);

		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");

		this.plugin.viewRegistry.unregister(this.viewId);

		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		// Clean up all tab adapters
		for (const tabId of this.tabAdapterIds) {
			await this.plugin.removeSessionAdapter(tabId);
		}
		this.tabAdapterIds.clear();
	}
}
