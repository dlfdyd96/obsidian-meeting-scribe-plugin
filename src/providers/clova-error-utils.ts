import { TransientError, ConfigError, DataError } from '../utils/errors';
import { logger } from '../utils/logger';

const COMPONENT = 'ClovaError';

function extractErrorMessage(err: unknown): string {
	if (err && typeof err === 'object' && 'message' in err) {
		const msg = (err as { message?: string }).message;
		if (typeof msg === 'string') return msg;
	}
	return '';
}

export function classifyClovaError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorMessage = extractErrorMessage(err);

	logger.debug(COMPONENT, 'API error details', {
		status,
		errorMessage,
		errKeys: err && typeof err === 'object' ? Object.keys(err) : [],
	});

	if (status === 401) {
		throw new ConfigError('Invalid CLOVA Speech credentials. Please check your Invoke URL and Secret Key in settings.');
	}
	if (status === 403) {
		throw new ConfigError('CLOVA Speech access denied. Please check your credentials and service permissions.');
	}
	if (status === 400) {
		throw new DataError(`Invalid request to CLOVA Speech: ${errorMessage || 'Bad request'}`);
	}
	if (status === 429) {
		throw new ConfigError('CLOVA Speech quota exceeded. Please check your billing settings in Naver Cloud console.');
	}
	if (status === 500 || status === 503) {
		throw new TransientError('CLOVA Speech server error. Will retry shortly.');
	}

	if (status) {
		throw new TransientError(`CLOVA Speech HTTP error (status ${status}). Will retry shortly.`);
	}

	throw new TransientError(
		`Network error communicating with CLOVA Speech: ${err instanceof Error ? err.message : String(err)}`,
	);
}

export function classifyClovaResultError(result: string, message: string): never {
	logger.debug(COMPONENT, 'Recognition failed', { result, message });
	throw new DataError(`CLOVA Speech recognition failed: ${message || result}`);
}
