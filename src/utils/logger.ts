export interface LoggerConfig {
	debugMode: boolean;
}

let globalLogger: Logger | null = null;

export function initializeLogger(config: LoggerConfig): void {
	globalLogger = new Logger(config);
}

export function getLogger(): Logger {
	if (!globalLogger) {
		return new Logger({ debugMode: false });
	}
	return globalLogger;
}

export class Logger {
	constructor(private config: LoggerConfig) {}

	log(...args: unknown[]): void {
		if (this.config.debugMode) {
			console.debug(...args);
		}
	}

	error(...args: unknown[]): void {
		if (this.config.debugMode) {
			console.error(...args);
		}
	}

	warn(...args: unknown[]): void {
		if (this.config.debugMode) {
			console.warn(...args);
		}
	}

	info(...args: unknown[]): void {
		if (this.config.debugMode) {
			console.debug(...args);
		}
	}
}
