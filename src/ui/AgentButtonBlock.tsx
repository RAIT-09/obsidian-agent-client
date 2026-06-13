import * as React from "react";
const { useCallback, useMemo } = React;
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
	const resolvedAgentId = useMemo(() => {
		return resolveAgentId(plugin, config.agent);
	}, [plugin, config.agent]);

	const avatarSrc = useMemo(() => {
		return resolveImageSrc(
			plugin,
			getAgentAvatarImage(plugin, resolvedAgentId),
		);
	}, [plugin, resolvedAgentId]);

	const handleClick = useCallback(async () => {
		try {
			await plugin.runPromptInChat({
				agentId: resolvedAgentId,
				prompt: config.prompt,
				autoSend: config.autoSend ?? false,
				viewType: config.viewType ?? "right-pane",
				sourcePath: mountCtx.sourcePath,
				lineStart: mountCtx.lineStart,
			});
		} catch (error) {
			console.error("[Agent Client] runPromptInChat failed:", error);
			new Notice("Failed to open chat with prompt.");
		}
	}, [plugin, resolvedAgentId, config]);

	return (
		<div className="agent-client-button-block">
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
