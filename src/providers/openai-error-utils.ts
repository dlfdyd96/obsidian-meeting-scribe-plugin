import { TransientError, ConfigError, DataError } from '../utils/errors';
import { logger } from '../utils/logger';

function extractErrorMessage(err: unknown): string {
	// Try .json.error.message (Obsidian requestUrl parsed body)
	const errorJson = (err as { json?: { error?: { message?: string } } }).json;
	if (errorJson?.error?.message) return errorJson.error.message;

	// Try parsing .text as JSON fallback (some Obsidian versions)
	const text = (err as { text?: string }).text;
	if (text) {
		try {
			const parsed = JSON.parse(text) as { error?: { message?: string } };
			if (parsed?.error?.message) return parsed.error.message;
		} catch { /* not JSON */ }
		// Return raw text if short enough to be useful
		if (text.length <= 200) return text;
	}

	return '';
}

export function classifyOpenAIError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorMessage = extractErrorMessage(err);

	logger.debug('OpenAIError', 'API error details', {
		status,
		errorMessage,
		errKeys: err && typeof err === 'object' ? Object.keys(err) : [],
	});

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
