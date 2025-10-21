/**
 * Switch Agent Use Case
 *
 * Handles switching between different AI agents.
 * Responsibilities:
 * - Switch active agent
 * - Get current agent information
 * - List available agents
 */

import type { ISettingsAccess } from "../domain/ports/settings-access.port";

// ============================================================================
// Output Types
// ============================================================================

/**
 * Agent information for display
 */
export interface AgentInfo {
	/** Unique agent ID */
	id: string;

	/** Display name for UI */
	displayName: string;
}

// ============================================================================
// Use Case Implementation
// ============================================================================

export class SwitchAgentUseCase {
	constructor(private settingsAccess: ISettingsAccess) {}

	/**
	 * Get the currently active agent ID
	 */
	getActiveAgentId(): string {
		const settings = this.settingsAccess.getSnapshot();
		return settings.activeAgentId || settings.claude.id;
	}

	/**
	 * Get the currently active agent information
	 */
	getCurrentAgent(): AgentInfo {
		const activeId = this.getActiveAgentId();
		const agents = this.getAvailableAgents();
		return (
			agents.find((agent) => agent.id === activeId) || {
				id: activeId,
				displayName: activeId,
			}
		);
	}

	/**
	 * Get list of all available agents
	 */
	getAvailableAgents(): AgentInfo[] {
		const settings = this.settingsAccess.getSnapshot();

		const agents = [
			{
				id: settings.claude.id,
				displayName: settings.claude.displayName || settings.claude.id,
			},
			{
				id: settings.gemini.id,
				displayName: settings.gemini.displayName || settings.gemini.id,
			},
			{
				id: settings.codex.id,
				displayName: settings.codex.displayName || settings.codex.id,
			},
			...settings.customAgents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName || agent.id,
			})),
		];

		return agents;
	}

	/**
	 * Switch to a different agent
	 *
	 * Updates the activeAgentId in settings.
	 * Note: The caller is responsible for creating a new session
	 * with the new agent if needed.
	 */
	async switchAgent(agentId: string): Promise<void> {
		await this.settingsAccess.updateSettings({
			activeAgentId: agentId,
		});
	}
}
