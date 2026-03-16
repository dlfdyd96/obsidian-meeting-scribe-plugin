import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryWithBackoff } from '../../src/utils/retry';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';
import { logger } from '../../src/utils/logger';

vi.mock('../../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe('retryWithBackoff', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('should return result on first success', async () => {
		const fn = vi.fn().mockResolvedValue('success');

		const result = await retryWithBackoff(fn);

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('should retry on TransientError and succeed', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new TransientError('temporary failure'))
			.mockResolvedValueOnce('recovered');

		const promise = retryWithBackoff(fn);
		await vi.advanceTimersByTimeAsync(1000);
		const result = await promise;

		expect(result).toBe('recovered');
		expect(fn).toHaveBeenCalledTimes(2);
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it('should throw after all retries exhausted', async () => {
		const fn = vi.fn().mockImplementation(async () => {
			throw new TransientError('persistent failure');
		});

		const promise = retryWithBackoff(fn).catch((e: unknown) => e);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(4000);

		const error = await promise;
		expect(error).toBeInstanceOf(TransientError);
		expect((error as TransientError).message).toBe('persistent failure');
		expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
	});

	it('should not retry ConfigError', async () => {
		const fn = vi.fn().mockRejectedValue(new ConfigError('bad config'));

		await expect(retryWithBackoff(fn)).rejects.toThrow(ConfigError);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('should not retry DataError', async () => {
		const fn = vi.fn().mockRejectedValue(new DataError('bad data'));

		await expect(retryWithBackoff(fn)).rejects.toThrow(DataError);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('should not retry plain Error', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('unknown error'));

		await expect(retryWithBackoff(fn)).rejects.toThrow('unknown error');
		expect(fn).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('should use exponential backoff delays (1s, 2s, 4s)', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new TransientError('fail 1'))
			.mockRejectedValueOnce(new TransientError('fail 2'))
			.mockRejectedValueOnce(new TransientError('fail 3'))
			.mockResolvedValueOnce('success');

		const promise = retryWithBackoff(fn);

		// After 999ms — first retry not yet triggered
		await vi.advanceTimersByTimeAsync(999);
		expect(fn).toHaveBeenCalledTimes(1);

		// After 1ms more (total 1000ms) — first retry fires
		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(2);

		// After 2000ms — second retry fires
		await vi.advanceTimersByTimeAsync(2000);
		expect(fn).toHaveBeenCalledTimes(3);

		// After 4000ms — third retry fires
		await vi.advanceTimersByTimeAsync(4000);
		expect(fn).toHaveBeenCalledTimes(4);

		const result = await promise;
		expect(result).toBe('success');
	});

	it('should log warning on each retry attempt with details', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new TransientError('error 1'))
			.mockRejectedValueOnce(new TransientError('error 2'))
			.mockResolvedValueOnce('ok');

		const promise = retryWithBackoff(fn);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await promise;

		expect(logger.warn).toHaveBeenCalledTimes(2);

		expect(logger.warn).toHaveBeenNthCalledWith(
			1,
			'Retry',
			'Attempt 1 failed, retrying in 1000ms',
			{ error: 'error 1', attempt: 1, maxRetries: 3 },
		);

		expect(logger.warn).toHaveBeenNthCalledWith(
			2,
			'Retry',
			'Attempt 2 failed, retrying in 2000ms',
			{ error: 'error 2', attempt: 2, maxRetries: 3 },
		);
	});

	it('should support custom retry options', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new TransientError('fail'))
			.mockResolvedValueOnce('ok');

		const promise = retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 500 });
		await vi.advanceTimersByTimeAsync(500);
		const result = await promise;

		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
		expect(logger.warn).toHaveBeenCalledWith(
			'Retry',
			'Attempt 1 failed, retrying in 500ms',
			{ error: 'fail', attempt: 1, maxRetries: 1 },
		);
	});
});
