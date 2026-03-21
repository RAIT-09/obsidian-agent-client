/**
 * Agent Update Checker
 *
 * Checks built-in agent ACP adapters for:
 * 1. Package migration — deprecated packages that have been renamed
 * 2. Version updates — newer versions available on npm
 *
 * Pure functions (non-React). Uses Obsidian's requestUrl for network access.
 */

import { requestUrl } from "obsidian";
import * as semver from "semver";
import type { OverlayVariant } from "../ui/ErrorBanner";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent update notification to display in the UI.
 * Compatible with ErrorInfo shape (title/message/suggestion).
 */
export interface AgentUpdateNotification {
	/** Visual variant for the overlay */
	variant: OverlayVariant;
	/** Short notification title */
	title: string;
	/** Detailed notification message */
	message: string;
	/** Actionable suggestion (e.g., npm command) */
	suggestion?: string;
}

// ============================================================================
// Known Packages
// ============================================================================

/**
 * Maps agentInfo.name → npm package name.
 * Agents may report their name with or without the npm scope prefix,
 * so we handle both forms.
 */
const KNOWN_AGENT_PACKAGES: Readonly<Record<string, string>> = {
	"@zed-industries/claude-agent-acp": "@zed-industries/claude-agent-acp",
	"codex-acp": "@zed-industries/codex-acp",
};

/**
 * Deprecated agentInfo.name → replacement npm package name.
 * Used to detect users still running old/renamed packages.
 */
const DEPRECATED_PACKAGES: Readonly<Record<string, string>> = {
	"@zed-industries/claude-code-acp": "@zed-industries/claude-agent-acp",
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if the agent needs a package migration or version update.
 *
 * Priority: migration notification > version update notification.
 * - Migration is checked locally (no network) based on agentInfo.name.
 * - Version update queries the npm registry.
 *
 * @returns AgentUpdateNotification if action needed, null otherwise.
 */
export async function checkAgentUpdate(agentInfo: {
	name: string;
	version?: string;
}): Promise<AgentUpdateNotification | null> {
	// 1. Check for deprecated package (migration takes priority)
	const replacement = DEPRECATED_PACKAGES[agentInfo.name];
	if (replacement) {
		return {
			variant: "info",
			title: "Package Migration Required",
			message: `"${agentInfo.name}" has been renamed to "${replacement}".\nRun the following in your terminal:`,
			suggestion: `npm uninstall -g ${agentInfo.name} && npm install -g ${replacement}`,
		};
	}

	// 2. Check for version update (known packages only)
	const npmPackage = KNOWN_AGENT_PACKAGES[agentInfo.name];
	if (!npmPackage || !agentInfo.version) {
		return null;
	}

	try {
		const latestVersion = await fetchLatestVersion(npmPackage);
		if (
			latestVersion &&
			semver.valid(agentInfo.version) &&
			semver.gt(latestVersion, agentInfo.version)
		) {
			return {
				variant: "info",
				title: "Agent Update Available",
				message: `${npmPackage}: ${agentInfo.version} → ${latestVersion}.\nRun the following in your terminal:`,
				suggestion: `npm install -g ${npmPackage}@latest`,
			};
		}
	} catch {
		// Silently ignore network errors — update check is best-effort
	}

	return null;
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Fetch the latest version of an npm package from the registry.
 */
async function fetchLatestVersion(packageName: string): Promise<string | null> {
	const response = await requestUrl({
		url: `https://registry.npmjs.org/${packageName}/latest`,
	});
	const data = response.json as { version?: string };
	return data.version ? (semver.clean(data.version) ?? null) : null;
}
