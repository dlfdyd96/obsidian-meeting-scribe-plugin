import { describe, it, expect } from 'vitest';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';

describe('TransientError', () => {
	it('should have retryable = true', () => {
		const error = new TransientError('network timeout');
		expect(error.retryable).toBe(true);
	});

	it('should extend Error', () => {
		const error = new TransientError('network timeout');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have name = "TransientError"', () => {
		const error = new TransientError('network timeout');
		expect(error.name).toBe('TransientError');
	});

	it('should preserve the message', () => {
		const error = new TransientError('API rate limit exceeded');
		expect(error.message).toBe('API rate limit exceeded');
	});

	it('should be identifiable with instanceof', () => {
		const error = new TransientError('timeout');
		expect(error instanceof TransientError).toBe(true);
		expect(error instanceof ConfigError).toBe(false);
		expect(error instanceof DataError).toBe(false);
	});
});

describe('ConfigError', () => {
	it('should have retryable = false', () => {
		const error = new ConfigError('invalid API key');
		expect(error.retryable).toBe(false);
	});

	it('should extend Error', () => {
		const error = new ConfigError('invalid API key');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have name = "ConfigError"', () => {
		const error = new ConfigError('invalid API key');
		expect(error.name).toBe('ConfigError');
	});

	it('should preserve the message', () => {
		const error = new ConfigError('missing STT provider');
		expect(error.message).toBe('missing STT provider');
	});

	it('should be identifiable with instanceof', () => {
		const error = new ConfigError('bad config');
		expect(error instanceof ConfigError).toBe(true);
		expect(error instanceof TransientError).toBe(false);
		expect(error instanceof DataError).toBe(false);
	});
});

describe('DataError', () => {
	it('should have retryable = false', () => {
		const error = new DataError('corrupt audio file');
		expect(error.retryable).toBe(false);
	});

	it('should extend Error', () => {
		const error = new DataError('corrupt audio file');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have name = "DataError"', () => {
		const error = new DataError('corrupt audio file');
		expect(error.name).toBe('DataError');
	});

	it('should preserve the message', () => {
		const error = new DataError('invalid response format');
		expect(error.message).toBe('invalid response format');
	});

	it('should be identifiable with instanceof', () => {
		const error = new DataError('bad data');
		expect(error instanceof DataError).toBe(true);
		expect(error instanceof TransientError).toBe(false);
		expect(error instanceof ConfigError).toBe(false);
	});
});
