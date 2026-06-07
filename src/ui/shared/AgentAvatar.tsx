import * as React from "react";
const { useMemo } = React;
import { setIcon } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import {
	getAgentAvatarImage,
	resolveImageSrc,
} from "../../utils/resolve-image-src";

export function getResolvedAgentAvatarSrc(
	plugin: AgentClientPlugin,
	agentId: string | undefined,
): string | null {
	if (!plugin.settings.showAgentImagesInChatInterfaces) return null;
	return resolveImageSrc(plugin, getAgentAvatarImage(plugin, agentId));
}

export function AgentAvatar({
	plugin,
	agentId,
	className = "agent-client-agent-avatar",
	fallbackIcon = "bot",
}: {
	plugin: AgentClientPlugin;
	agentId: string | undefined;
	className?: string;
	fallbackIcon?: string;
}) {
	const showAgentImages = plugin.settings.showAgentImagesInChatInterfaces;
	const src = useMemo(
		() => getResolvedAgentAvatarSrc(plugin, agentId),
		[plugin, agentId, showAgentImages],
	);

	if (!showAgentImages) return null;

	if (src) {
		return <img src={src} alt="" className={className} />;
	}

	return (
		<span
			className={`${className} agent-client-agent-avatar-fallback`}
			ref={(el) => {
				if (el) setIcon(el, fallbackIcon);
			}}
		/>
	);
}
