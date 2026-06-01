import * as React from "react";
const { useCallback, useMemo, useState } = React;
import { createRoot, type Root } from "react-dom/client";
import { Notice } from "obsidian";

import type AgentClientPlugin from "../plugin";
import {
	getAgentAvatarImage,
	resolveImageSrc,
} from "../utils/resolve-image-src";
import type { AgentButtonBlockConfig } from "../utils/agent-block-parser";

interface AgentButtonBlockProps {
	plugin: AgentClientPlugin;
	config: AgentButtonBlockConfig;
	mountCtx: AgentButtonMountContext;
}

export interface AgentButtonMountContext {
	sourcePath: string;
	lineStart: number;
}

function resolveAgentId(
	plugin: AgentClientPlugin,
	preferred: string | undefined,
): string {
	const available = plugin.getAvailableAgents().map((a) => a.id);
	if (preferred && available.includes(preferred)) return preferred;
	return plugin.settings.defaultAgentId;
}

function AgentButtonBlockComponent({
	plugin,
	config,
	mountCtx,
}: AgentButtonBlockProps) {
	// Whether this rendered button has been clicked. Used to hide it when
	// hideAfterClick is set; resets when the note is re-rendered.
	const [dismissed, setDismissed] = useState(false);

	const quickPrompt = useMemo(() => {
		return plugin.findQuickPrompt(config.promptName);
	}, [plugin, config.promptName]);

	const resolvedAgentId = useMemo(() => {
		return resolveAgentId(plugin, config.agent ?? quickPrompt?.agentId);
	}, [plugin, config.agent, quickPrompt?.agentId]);

	const avatarSrc = useMemo(() => {
		return resolveImageSrc(
			plugin,
			getAgentAvatarImage(plugin, resolvedAgentId),
		);
	}, [plugin, resolvedAgentId]);

	const handleClick = useCallback(async () => {
		const promptText = config.prompt ?? quickPrompt?.prompt;
		if (!promptText) {
			new Notice(
				config.promptName
					? `Quick prompt "${config.promptName}" was not found.`
					: "Button block has no prompt.",
			);
			return;
		}

		try {
			if (quickPrompt && !config.prompt) {
				await plugin.incrementQuickPromptUsage(quickPrompt.name);
			}
			await plugin.runPromptInChat({
				agentId: resolvedAgentId,
				prompt: promptText,
				autoSend: config.autoSend ?? false,
				viewType: config.viewType ?? "right-pane",
				sourcePath: mountCtx.sourcePath,
				lineStart: mountCtx.lineStart,
			});

			// Hide the button after a successful click when requested. The
			// YAML field wins; otherwise fall back to the quick prompt's setting.
			const shouldHide =
				config.hideAfterClick ?? quickPrompt?.hideAfterClick ?? false;
			if (shouldHide) {
				setDismissed(true);
			}
		} catch (error) {
			console.error("[Agent Client] runPromptInChat failed:", error);
			new Notice("Failed to open chat with prompt.");
		}
	}, [plugin, resolvedAgentId, config, quickPrompt, mountCtx]);

	if (dismissed) return null;

	return (
		<div
			className={`agent-client-button-block agent-client-button-block-align-${config.align ?? "left"}`}
		>
			<button
				type="button"
				className="agent-client-button-block-button mod-cta"
				onClick={() => void handleClick()}
			>
				{avatarSrc && (
					<img
						src={avatarSrc}
						alt=""
						className="agent-client-button-block-avatar"
					/>
				)}
				<span className="agent-client-button-block-text">
					{config.text}
				</span>
			</button>
		</div>
	);
}

export function mountAgentButtonBlock(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	config: AgentButtonBlockConfig,
	mountCtx: AgentButtonMountContext,
): Root {
	const container = el.createDiv();
	const root = createRoot(container);
	root.render(
		<AgentButtonBlockComponent
			plugin={plugin}
			config={config}
			mountCtx={mountCtx}
		/>,
	);
	return root;
}
