import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

export class Logger {
	constructor(private plugin: AgentClientPlugin) {}

	log(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.log(...args);
		}
	}

	error(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.error(...args);
		}
	}

	warn(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.warn(...args);
		}
	}

	info(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.info(...args);
		}
	}
}
