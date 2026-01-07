import type { AgentCapabilities } from "../domain/ports/agent-client.port";

/**
 * Session capability flags for UI conditional rendering.
 */
export interface SessionCapabilityFlags {
	/** Whether session/load is supported (stable) */
	canLoad: boolean;
	/** Whether session/resume is supported (unstable) */
	canResume: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;
}

/**
 * Extract session capability flags from agent capabilities.
 *
 * Used by UI components to determine which session management features
 * should be displayed based on the agent's capabilities.
 *
 * Detection logic:
 * - session/load: agentCapabilities.loadSession === true
 * - session/resume: agentCapabilities.sessionCapabilities?.resume !== undefined
 * - session/fork: agentCapabilities.sessionCapabilities?.fork !== undefined
 * - session/list: agentCapabilities.sessionCapabilities?.list !== undefined
 *
 * @param agentCapabilities - Agent capabilities from ChatSession
 * @returns Object with boolean flags for each session capability
 */
export function getSessionCapabilityFlags(
	agentCapabilities?: AgentCapabilities,
): SessionCapabilityFlags {
	const sessionCaps = agentCapabilities?.sessionCapabilities;
	return {
		canLoad: agentCapabilities?.loadSession === true,
		canResume: sessionCaps?.resume !== undefined,
		canFork: sessionCaps?.fork !== undefined,
		canList: sessionCaps?.list !== undefined,
	};
}
