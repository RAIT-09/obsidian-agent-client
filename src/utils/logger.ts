export interface LoggerConfig {
	debugMode: boolean;
}

let globalLogger: Logger | null = null;

export function initializeLogger(config: LoggerConfig): void {
	if (globalLogger) {
		globalLogger.setDebugMode(config.debugMode);
	} else {
		globalLogger = new Logger(config);
	}
}

export function getLogger(): Logger {
	if (!globalLogger) {
		globalLogger = new Logger({ debugMode: false });
	}
	return globalLogger;
}

export function updateDebugMode(debugMode: boolean): void {
	if (globalLogger) {
		globalLogger.setDebugMode(debugMode);
	}
}

export class Logger {
	private debugMode: boolean;

	constructor(config: LoggerConfig) {
		this.debugMode = config.debugMode;
	}

	setDebugMode(debugMode: boolean): void {
		this.debugMode = debugMode;
	}

	log(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug("[Debug]", ...args);
		}
	}

	debug(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug("[Debug]", ...args);
		}
	}

	info(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug("[Debug]", ...args);
		}
	}

	error(...args: unknown[]): void {
		console.error(...args);
	}

	warn(...args: unknown[]): void {
		console.warn(...args);
	}
}
