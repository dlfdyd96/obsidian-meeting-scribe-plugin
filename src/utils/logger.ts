const PREFIX = '[MeetingScribe]';

export class Logger {
	private debugMode = false;

	setDebugMode(enabled: boolean): void {
		this.debugMode = enabled;
	}

	debug(component: string, message: string, context?: Record<string, unknown>): void {
		if (!this.debugMode) return;
		if (context) {
			console.debug(PREFIX, '[DEBUG]', `[${component}]`, message, context);
		} else {
			console.debug(PREFIX, '[DEBUG]', `[${component}]`, message);
		}
	}

	info(component: string, message: string, context?: Record<string, unknown>): void {
		if (context) {
			console.debug(PREFIX, '[INFO]', `[${component}]`, message, context);
		} else {
			console.debug(PREFIX, '[INFO]', `[${component}]`, message);
		}
	}

	warn(component: string, message: string, context?: Record<string, unknown>): void {
		if (context) {
			console.warn(PREFIX, '[WARN]', `[${component}]`, message, context);
		} else {
			console.warn(PREFIX, '[WARN]', `[${component}]`, message);
		}
	}

	error(component: string, message: string, context?: Record<string, unknown>): void {
		if (context) {
			console.error(PREFIX, '[ERROR]', `[${component}]`, message, context);
		} else {
			console.error(PREFIX, '[ERROR]', `[${component}]`, message);
		}
	}
}

export const logger = new Logger();
