import { describe, it, expect } from 'vitest';
import { classifyGoogleCloudError, classifyGoogleCloudOperationError } from '../../src/providers/google-cloud-error-utils';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';

describe('classifyGoogleCloudError', () => {
	it('should throw ConfigError for 401 status', () => {
		expect(() => classifyGoogleCloudError({ status: 401 })).toThrow(ConfigError);
		expect(() => classifyGoogleCloudError({ status: 401 })).toThrow('credentials');
	});

	it('should throw ConfigError for 403 status', () => {
		expect(() => classifyGoogleCloudError({ status: 403 })).toThrow(ConfigError);
		expect(() => classifyGoogleCloudError({ status: 403 })).toThrow('access denied');
	});

	it('should throw DataError for 400 status', () => {
		expect(() => classifyGoogleCloudError({ status: 400, message: 'unsupported encoding' })).toThrow(DataError);
		expect(() => classifyGoogleCloudError({ status: 400, message: 'unsupported encoding' })).toThrow('unsupported encoding');
	});

	it('should throw DataError with fallback message for 400 without message', () => {
		expect(() => classifyGoogleCloudError({ status: 400 })).toThrow(DataError);
		expect(() => classifyGoogleCloudError({ status: 400 })).toThrow('Bad request');
	});

	it('should throw TransientError for 429 status (rate limited)', () => {
		expect(() => classifyGoogleCloudError({ status: 429 })).toThrow(TransientError);
		expect(() => classifyGoogleCloudError({ status: 429 })).toThrow('rate limit');
	});

	it('should throw TransientError for 500 status', () => {
		expect(() => classifyGoogleCloudError({ status: 500 })).toThrow(TransientError);
		expect(() => classifyGoogleCloudError({ status: 500 })).toThrow('server error');
	});

	it('should throw TransientError for 503 status', () => {
		expect(() => classifyGoogleCloudError({ status: 503 })).toThrow(TransientError);
		expect(() => classifyGoogleCloudError({ status: 503 })).toThrow('server error');
	});

	it('should throw TransientError for network errors (no status)', () => {
		const err = new Error('fetch failed');
		expect(() => classifyGoogleCloudError(err)).toThrow(TransientError);
		expect(() => classifyGoogleCloudError(err)).toThrow('fetch failed');
	});

	it('should throw TransientError with HTTP status message for unknown status codes', () => {
		expect(() => classifyGoogleCloudError({ status: 502 })).toThrow(TransientError);
		expect(() => classifyGoogleCloudError({ status: 502 })).toThrow('HTTP error (status 502)');
	});
});

describe('classifyGoogleCloudOperationError', () => {
	it('should throw DataError with error message', () => {
		expect(() => classifyGoogleCloudOperationError({ code: 3, message: 'Invalid audio data' })).toThrow(DataError);
		expect(() => classifyGoogleCloudOperationError({ code: 3, message: 'Invalid audio data' })).toThrow('Invalid audio data');
	});

	it('should throw DataError with fallback when message is empty', () => {
		expect(() => classifyGoogleCloudOperationError({ code: 3, message: '' })).toThrow(DataError);
		expect(() => classifyGoogleCloudOperationError({ code: 3, message: '' })).toThrow('recognition failed');
	});
});
