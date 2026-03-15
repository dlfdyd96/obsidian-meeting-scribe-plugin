import { TransientError, ConfigError, DataError } from '../utils/errors';

export function classifyOpenAIError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorJson = (err as { json?: { error?: { message?: string } } }).json;
	const errorMessage = errorJson?.error?.message ?? '';

	if (status === 401) {
		throw new ConfigError('Invalid OpenAI API key. Please check your API key in settings.');
	}
	if (status === 403) {
		throw new ConfigError('OpenAI API access denied. Your region or account may not be supported.');
	}
	if (status === 400) {
		throw new DataError(`Invalid request: ${errorMessage}`);
	}
	if (status === 413) {
		throw new DataError('Request payload too large.');
	}
	if (status === 429) {
		const msg = errorMessage.toLowerCase();
		if (msg.includes('insufficient_quota') || msg.includes('billing')) {
			throw new ConfigError('OpenAI API quota exceeded. Please check your billing settings.');
		}
		throw new TransientError('OpenAI API rate limit reached. Will retry shortly.');
	}
	if (status === 500 || status === 503) {
		throw new TransientError('OpenAI API server error. Will retry shortly.');
	}

	throw new TransientError(
		`Network error communicating with OpenAI: ${err instanceof Error ? err.message : String(err)}`,
	);
}
