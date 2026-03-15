import { TransientError, ConfigError, DataError } from '../utils/errors';

export function classifyAnthropicError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorJson = (err as { json?: { error?: { message?: string } } }).json;
	const errorMessage = errorJson?.error?.message ?? '';

	if (status === 401) {
		throw new ConfigError('Invalid Anthropic API key. Please check your API key in settings.');
	}
	if (status === 403) {
		throw new ConfigError('Anthropic API access denied. Your account may not have the required permissions.');
	}
	if (status === 400) {
		throw new DataError(`Invalid request: ${errorMessage}`);
	}
	if (status === 429) {
		throw new TransientError('Anthropic API rate limit reached. Will retry shortly.');
	}
	if (status === 500 || status === 503) {
		throw new TransientError('Anthropic API server error. Will retry shortly.');
	}
	if (status === 529) {
		throw new TransientError('Anthropic API is temporarily overloaded. Will retry shortly.');
	}

	throw new TransientError(
		`Network error communicating with Anthropic: ${err instanceof Error ? err.message : String(err)}`,
	);
}
