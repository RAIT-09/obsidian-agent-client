/**
 * Plugin Context
 *
 * Provides access to the AgentClientPlugin instance throughout the React component tree.
 * This eliminates the need to pass the plugin instance as props through multiple levels.
 */

import * as React from "react";
const { createContext, useContext } = React;
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

/**
 * Context for accessing the plugin instance.
 */
const PluginContext = createContext<AgentClientPlugin | null>(null);

/**
 * Provider component for the plugin context.
 */
export function PluginProvider({
	plugin,
	children,
}: {
	plugin: AgentClientPlugin;
	children: React.ReactNode;
}) {
	return (
		<PluginContext.Provider value={plugin}>
			{children}
		</PluginContext.Provider>
	);
}

/**
 * Hook to access the plugin instance.
 *
 * @throws Error if used outside of PluginProvider
 * @returns The AgentClientPlugin instance
 */
export function usePlugin(): AgentClientPlugin {
	const plugin = useContext(PluginContext);
	if (!plugin) {
		throw new Error("usePlugin must be used within a PluginProvider");
	}
	return plugin;
}

/**
 * Hook to access the plugin instance (nullable version).
 *
 * Use this when you need to check if the plugin is available.
 *
 * @returns The AgentClientPlugin instance or null
 */
export function usePluginOptional(): AgentClientPlugin | null {
	return useContext(PluginContext);
}

export { PluginContext };
