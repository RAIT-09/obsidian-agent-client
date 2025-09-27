import type AgentClientPlugin from "../main";

export class Logger {
	constructor(private plugin: AgentClientPlugin) {}

	log(...args: any[]): void {
		if (this.plugin.settings.debugMode) {
			console.log(...args);
		}
	}

	error(...args: any[]): void {
		if (this.plugin.settings.debugMode) {
			console.error(...args);
		}
	}

	warn(...args: any[]): void {
		if (this.plugin.settings.debugMode) {
			console.warn(...args);
		}
	}

	info(...args: any[]): void {
		if (this.plugin.settings.debugMode) {
			console.info(...args);
		}
	}
}
