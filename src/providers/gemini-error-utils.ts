import { TransientError, ConfigError, DataError } from '../utils/errors';
import { logger } from '../utils/logger';

const COMPONENT = 'GeminiError';

function extractErrorMessage(err: unknown): string {
	if (err && typeof err === 'object' && 'message' in err) {
		const msg = (err as { message?: string }).message;
		if (typeof msg === 'string') return msg;
	}
	return '';
}

export function classifyGeminiError(err: unknown): never {
	if (err instanceof ConfigError || err instanceof TransientError || err instanceof DataError) {
		throw err;
	}

	const status = (err as { status?: number }).status;
	const errorMessage = extractErrorMessage(err);

	logger.debug(COMPONENT, 'API error details', {
		status,
		errorMessage,
		errKeys: err && typeof err === 'object' ? Object.keys(err) : [],
	});

	if (status === 401 || status === 403) {
		throw new ConfigError('Invalid Gemini API key. Please check your API key in settings.');
	}
	if (status === 400) {
		throw new DataError(`Invalid request to Gemini API: ${errorMessage || 'Bad request'}`);
	}
	if (status === 429) {
		throw new TransientError('Rate limited by Gemini API. Will retry shortly.');
	}
	if (status === 500 || status === 502 || status === 503) {
		throw new TransientError('Gemini API server error. Will retry shortly.');
	}

	if (status) {
		throw new TransientError(`Gemini API HTTP error (status ${status}). Will retry shortly.`);
	}

	throw new TransientError(
		`Network error communicating with Gemini API: ${err instanceof Error ? err.message : String(err)}`,
	);
}
