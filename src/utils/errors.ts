export class TransientError extends Error {
	readonly retryable = true;

	constructor(message: string) {
		super(message);
		this.name = 'TransientError';
	}
}

export class ConfigError extends Error {
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

export class DataError extends Error {
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'DataError';
	}
}
