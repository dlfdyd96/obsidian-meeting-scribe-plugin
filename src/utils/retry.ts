import { TransientError } from './errors';
import { logger } from './logger';
import { MAX_RETRY_COUNT, RETRY_BASE_DELAY_MS } from '../constants';

const COMPONENT = 'Retry';

export interface RetryOptions {
	maxRetries: number;
	baseDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
	maxRetries: MAX_RETRY_COUNT,
	baseDelayMs: RETRY_BASE_DELAY_MS,
};

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options?: Partial<RetryOptions>,
): Promise<T> {
	const { maxRetries, baseDelayMs } = { ...DEFAULT_OPTIONS, ...options };
	let lastError: TransientError | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error: unknown) {
			if (!(error instanceof TransientError)) {
				throw error;
			}
			lastError = error;
			if (attempt < maxRetries) {
				const delayMs = baseDelayMs * Math.pow(2, attempt);
				logger.warn(COMPONENT, `Attempt ${attempt + 1} failed, retrying in ${delayMs}ms`, {
					error: error.message,
					attempt: attempt + 1,
					maxRetries,
				});
				await delay(delayMs);
			}
		}
	}

	throw lastError!;
}
