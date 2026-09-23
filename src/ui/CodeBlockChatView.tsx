import * as React from "react";
const { useEffect, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";

import type AgentClientPlugin from "../plugin";
import { ChatContextProvider } from "./ChatContext";
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";
import { VaultService } from "../services/vault-service";
import type { AgentChatBlockConfig } from "../utils/agent-block-parser";
import type {
	IChatViewContainer,
	ChatViewType,
	SessionStatus,
} from "../services/view-registry";
import type { ChatInputState } from "../types/chat";

export interface CodeBlockMountContext {
	sourcePath: string;
	blockId: string;
	lineStart: number;
}

interface CodeBlockChatProps {
	plugin: AgentClientPlugin;
	viewId: string;
	config: AgentChatBlockConfig;
	mountCtx: CodeBlockMountContext;
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
}

function CodeBlockChatComponent({
	plugin,
	viewId,
	config,
	mountCtx,
	onRegisterCallbacks,
}: CodeBlockChatProps) {
	const acpClient = useMemo(
		() => plugin.getOrCreateAcpClient(viewId),
		[plugin, viewId],
	);

	const vaultService = useMemo(() => new VaultService(plugin), [plugin]);

	// Cleanup VaultService when the component unmounts. Mirrors
	// FloatingChatComponent: the AcpClient is intentionally NOT removed here so
	// that a re-render of the same code block (same viewId) reuses the existing
	// session. The container schedules a graceful AcpClient teardown on unmount
	// (cancelled by a remount within the grace window); any survivors are
	// reaped at plugin unload via _acpClients disconnect/clear.
	useEffect(() => {
		return () => {
			vaultService.destroy();
		};
	}, [vaultService]);

	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	const heightStyle = config.height
		? ({ "--ac-embedded-max-height": config.height } as React.CSSProperties)
		: undefined;

	// Memoize the ChatPanel props so React.memo(ChatPanel) can bail out across
	// re-renders. Shapes MUST match ChatPanelProps (config / embeddedConfig);
	// height is consumed locally (heightStyle), not passed.
	const memoizedConfig = useMemo(
		() => ({ agent: config.agent, model: config.model }),
		[config.agent, config.model],
	);
	const memoizedEmbeddedConfig = useMemo(
		() => ({
			persist: config.persist,
			noteContext: config.noteContext,
			sourcePath: mountCtx.sourcePath,
			id: config.id,
		}),
		[config.persist, config.noteContext, mountCtx.sourcePath, config.id],
	);

	return (
		<div className="agent-client-code-block-chat" style={heightStyle}>
			<ChatContextProvider value={contextValue}>
				<ChatPanel
					variant="embedded"
					viewId={viewId}
					onRegisterCallbacks={onRegisterCallbacks}
					initialAgentId={config.agent}
					config={memoizedConfig}
					embeddedConfig={memoizedEmbeddedConfig}
				/>
			</ChatContextProvider>
		</div>
	);
}

// ============================================================
// EmbeddedChatViewContainer Class
// ============================================================

/**
 * Wrapper that implements IChatViewContainer for embedded (code-block) chat
 * views. Mirrors FloatingViewContainer: this container owns the React root and
 * registry registration, while CodeBlockChatComponent owns service lifecycle.
 */
export class EmbeddedChatViewContainer implements IChatViewContainer {
	readonly viewType: ChatViewType = "embedded";
	readonly viewId: string;
	/** Host note path (used by findNearestEmbeddedChat). */
	readonly sourcePath: string;
	/** Section start line of this block (used by findNearestEmbeddedChat). */
	readonly lineStart: number;

	private plugin: AgentClientPlugin;
	private containerEl: HTMLElement;
	private root: Root | null = null;
	private callbacks: ChatPanelCallbacks | null = null;

	constructor(
		plugin: AgentClientPlugin,
		viewId: string,
		containerEl: HTMLElement,
		mountCtx: CodeBlockMountContext,
	) {
		this.plugin = plugin;
		this.viewId = viewId;
		this.containerEl = containerEl;
		this.sourcePath = mountCtx.sourcePath;
		this.lineStart = mountCtx.lineStart;
	}

	mount(config: AgentChatBlockConfig, mountCtx: CodeBlockMountContext): void {
		// Cancel any pending graceful teardown so re-processing churn reuses the
		// existing AcpClient instead of racing its disconnect.
		this.plugin.acquireAcpClient(this.viewId);
		this.root = createRoot(this.containerEl);
		this.root.render(
			<CodeBlockChatComponent
				plugin={this.plugin}
				viewId={this.viewId}
				config={config}
				mountCtx={mountCtx}
				onRegisterCallbacks={(cbs) => {
					this.callbacks = cbs;
				}}
			/>,
		);
		this.plugin.viewRegistry.register(this);
	}

	unmount(): void {
		this.plugin.viewRegistry.unregister(this.viewId);
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		// Schedule a graceful teardown of the AcpClient; a remount within the
		// grace window cancels it (re-processing churn), so only genuine removal
		// disconnects the agent process.
		this.plugin.releaseAcpClient(this.viewId);
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	getDisplayName(): string {
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	getSessionStatus(): SessionStatus {
		return this.callbacks?.getSessionStatus() ?? "disconnected";
	}

	getSessionTitle(): string {
		return this.callbacks?.getSessionTitle() ?? "New session";
	}

	getSessionId(): string | null {
		return this.callbacks?.getSessionId() ?? null;
	}

	onActivate(): void {
		this.containerEl.classList.add("is-focused");
	}

	onDeactivate(): void {
		this.containerEl.classList.remove("is-focused");
	}

	focus(): void {
		// The block can be registered yet invisible: its host note may sit in
		// a background tab (switching notes does NOT unmount embedded blocks).
		// Reveal the hosting leaf first — scrollIntoView and textarea.focus()
		// are no-ops on a hidden container — mirroring ChatView.focus()'s
		// revealLeaf and FloatingViewContainer.focus()'s expand.
		const hostLeaf = this.findHostLeaf();
		if (hostLeaf) {
			void this.plugin.app.workspace.revealLeaf(hostLeaf).then(() => {
				// The re-shown view re-attaches pruned sections with a delay
				// that is not observable up front (one frame is measurably too
				// short: focus() on a detached textarea is a silent no-op).
				// Wait per frame, bounded, until the block is back in the DOM.
				this.scrollAndFocusInputWhenConnected();
			});
			return;
		}
		this.scrollAndFocusInput();
	}

	/**
	 * Bounded per-frame wait for the block to be (re-)attached to the DOM,
	 * then scroll and focus. Sections far from the scroll position may stay
	 * pruned; give up silently after one second so a miss costs nothing.
	 */
	private scrollAndFocusInputWhenConnected(deadline = Date.now() + 1000): void {
		if (this.containerEl.isConnected) {
			this.scrollAndFocusInput();
			return;
		}
		if (Date.now() > deadline) return;
		window.requestAnimationFrame(() =>
			this.scrollAndFocusInputWhenConnected(deadline),
		);
	}

	/**
	 * The markdown leaf hosting this block, or null (e.g. a rendering context
	 * that is not a leaf). DOM containment is tried first: while the block is
	 * visible it picks the exact tab even when the same note is open in
	 * multiple tabs, so revealLeaf stays a no-op for the tab the user is
	 * already looking at. Containment fails while the block is detached —
	 * background tabs are pruned from the preview DOM (verified 2026-07-15:
	 * containerEl.isConnected === false) — so fall back to matching the
	 * leaf's file against sourcePath.
	 */
	private findHostLeaf(): WorkspaceLeaf | null {
		const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
		return (
			leaves.find((leaf) =>
				leaf.view.containerEl.contains(this.containerEl),
			) ??
			leaves.find(
				(leaf) =>
					leaf.view instanceof MarkdownView &&
					leaf.view.file?.path === this.sourcePath,
			) ??
			null
		);
	}

	private scrollAndFocusInput(): void {
		this.containerEl.scrollIntoView({ block: "nearest" });
		window.requestAnimationFrame(() => {
			const textarea = this.containerEl.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	hasFocus(): boolean {
		return this.containerEl.contains(activeDocument.activeElement);
	}

	// Embedded blocks have no collapsed state.
	expand(): void {}

	collapse(): void {}

	isExpanded(): boolean {
		return true;
	}

	// Owned by the host note's code block (MarkdownRenderChild); cannot be
	// closed from the session list.
	closeContainer(): void {}

	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}
}

export function mountCodeBlockChat(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	config: AgentChatBlockConfig,
	mountCtx: CodeBlockMountContext,
): EmbeddedChatViewContainer {
	const container = el.createDiv({ cls: "agent-client-code-block-host" });
	const viewId = `code-block:${mountCtx.blockId}`;
	const viewContainer = new EmbeddedChatViewContainer(
		plugin,
		viewId,
		container,
		mountCtx,
	);
	viewContainer.mount(config, mountCtx);
	return viewContainer;
}
