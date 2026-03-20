import { TransientError, ConfigError, DataError } from '../utils/errors';
import { logger } from '../utils/logger';

const COMPONENT = 'GoogleCloudError';

function extractErrorMessage(err: unknown): string {
	if (err && typeof err === 'object' && 'message' in err) {
		const msg = (err as { message?: string }).message;
		if (typeof msg === 'string') return msg;
	}
	return '';
}

export function classifyGoogleCloudError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorMessage = extractErrorMessage(err);

	logger.debug(COMPONENT, 'API error details', {
		status,
		errorMessage,
		errKeys: err && typeof err === 'object' ? Object.keys(err) : [],
	});

	if (status === 401) {
		throw new ConfigError('Invalid Google Cloud credentials. Please check your API key in settings.');
	}
	if (status === 403) {
		throw new ConfigError('Google Cloud access denied. Please check your API key permissions and project settings.');
	}
	if (status === 400) {
		throw new DataError(`Invalid request to Google Cloud STT: ${errorMessage || 'Bad request'}`);
	}
	if (status === 429) {
		throw new TransientError('Google Cloud STT rate limit exceeded. Will retry shortly.');
	}
	if (status === 500 || status === 503) {
		throw new TransientError('Google Cloud STT server error. Will retry shortly.');
	}

	if (status) {
		throw new TransientError(`Google Cloud STT HTTP error (status ${status}). Will retry shortly.`);
	}

	throw new TransientError(
		`Network error communicating with Google Cloud STT: ${err instanceof Error ? err.message : String(err)}`,
	);
}

export function classifyGoogleCloudOperationError(error: { code: number; message: string }): never {
	logger.debug(COMPONENT, 'Operation error', { code: error.code, message: error.message });
	throw new DataError(`Google Cloud STT recognition failed: ${error.message || 'recognition failed'}`);
}
