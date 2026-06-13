/**
 * Resolve a user-supplied image reference to a value usable in an <img src>.
 *
 * Accepts:
 * - http:// or https:// URLs (returned unchanged)
 * - data: URLs (returned unchanged)
 * - vault-relative paths (resolved via FileSystemAdapter.getResourcePath)
 *
 * Returns null for empty/missing input or non-FileSystemAdapter vaults.
 */

import { FileSystemAdapter } from "obsidian";
import type AgentClientPlugin from "../plugin";

export function resolveImageSrc(
	plugin: AgentClientPlugin,
	value: string | undefined | null,
): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;

	if (/^(https?:|data:)/i.test(trimmed)) {
		return trimmed;
	}

	const adapter = plugin.app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getResourcePath(trimmed);
	}
	return null;
}

export function getAgentAvatarImage(
	plugin: AgentClientPlugin,
	agentId: string | undefined,
): string | undefined {
	if (!agentId) return undefined;
	const settings = plugin.settings;
	if (agentId === settings.claude.id) return settings.claude.avatarImage;
	if (agentId === settings.codex.id) return settings.codex.avatarImage;
	if (agentId === settings.gemini.id) return settings.gemini.avatarImage;
	return settings.customAgents.find((agent) => agent.id === agentId)
		?.avatarImage;
}
