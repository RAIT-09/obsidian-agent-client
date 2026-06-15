import * as React from "react";
const { useEffect, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import { ChatContextProvider } from "./ChatContext";
import { ChatPanel } from "./ChatPanel";
import { VaultService } from "../services/vault-service";
import {
	getAgentAvatarImage,
	resolveImageSrc,
} from "../utils/resolve-image-src";
import type { AgentChatBlockConfig } from "../utils/agent-block-parser";

export interface CodeBlockMountContext {
	sourcePath: string;
	blockId: string;
	lineStart: number;
}

interface CodeBlockChatProps {
	plugin: AgentClientPlugin;
	config: AgentChatBlockConfig;
	mountCtx: CodeBlockMountContext;
}

function CodeBlockChatComponent({
	plugin,
	config,
	mountCtx,
}: CodeBlockChatProps) {
	const viewId = `code-block:${mountCtx.blockId}`;

	const acpClient = useMemo(
		() => plugin.getOrCreateAcpClient(viewId),
		[plugin, viewId],
	);

	const vaultService = useMemo(() => new VaultService(plugin), [plugin]);

	useEffect(() => {
		const unregisterEmbeddedChat = plugin.registerEmbeddedChat({
			viewId,
			sourcePath: mountCtx.sourcePath,
			lineStart: mountCtx.lineStart,
		});
		return () => {
			unregisterEmbeddedChat();
			vaultService.destroy();
			void plugin.removeAcpClient(viewId);
		};
	}, [plugin, viewId, vaultService, mountCtx.sourcePath, mountCtx.lineStart]);

	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	const avatarSrc = useMemo(() => {
		return (
			resolveImageSrc(plugin, config.image) ??
			resolveImageSrc(
				plugin,
				getAgentAvatarImage(plugin, config.agent),
			) ??
			resolveImageSrc(plugin, plugin.settings.floatingButtonImage)
		);
	}, [plugin, config.image, config.agent]);

	const heightStyle = config.height
		? ({ "--ac-embedded-max-height": config.height } as React.CSSProperties)
		: undefined;

	return (
		<div className="agent-client-code-block-chat" style={heightStyle}>
			{avatarSrc && (
				<div className="agent-client-code-block-chat-avatar-row">
					<img
						src={avatarSrc}
						alt=""
						className="agent-client-code-block-chat-avatar"
					/>
				</div>
			)}
			<ChatContextProvider value={contextValue}>
				<ChatPanel
					variant="embedded"
					viewId={viewId}
					initialAgentId={config.agent}
					config={{
						agent: config.agent,
						model: config.model,
						persist: config.persist,
						noteContext: config.noteContext,
						sourcePath: mountCtx.sourcePath,
					}}
				/>
			</ChatContextProvider>
		</div>
	);
}

export function mountCodeBlockChat(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	config: AgentChatBlockConfig,
	mountCtx: CodeBlockMountContext,
): Root {
	const container = el.createDiv({ cls: "agent-client-code-block-host" });
	const root = createRoot(container);
	root.render(
		<CodeBlockChatComponent
			plugin={plugin}
			config={config}
			mountCtx={mountCtx}
		/>,
	);
	return root;
}
