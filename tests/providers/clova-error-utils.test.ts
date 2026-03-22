import { describe, it, expect } from 'vitest';
import { classifyClovaError, classifyClovaResultError } from '../../src/providers/clova-error-utils';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';

describe('classifyClovaError', () => {
	it('should throw ConfigError for 401 status', () => {
		expect(() => classifyClovaError({ status: 401 })).toThrow(ConfigError);
		expect(() => classifyClovaError({ status: 401 })).toThrow('credentials');
	});

	it('should throw ConfigError for 403 status', () => {
		expect(() => classifyClovaError({ status: 403 })).toThrow(ConfigError);
		expect(() => classifyClovaError({ status: 403 })).toThrow('access denied');
	});

	it('should throw DataError for 400 status', () => {
		expect(() => classifyClovaError({ status: 400, message: 'unsupported format' })).toThrow(DataError);
		expect(() => classifyClovaError({ status: 400, message: 'unsupported format' })).toThrow('unsupported format');
	});

	it('should throw DataError with fallback message for 400 without message', () => {
		expect(() => classifyClovaError({ status: 400 })).toThrow(DataError);
		expect(() => classifyClovaError({ status: 400 })).toThrow('Bad request');
	});

	it('should throw TransientError for 429 status (rate limited)', () => {
		expect(() => classifyClovaError({ status: 429 })).toThrow(TransientError);
		expect(() => classifyClovaError({ status: 429 })).toThrow('Rate limited');
	});

	it('should throw TransientError for 500 status', () => {
		expect(() => classifyClovaError({ status: 500 })).toThrow(TransientError);
		expect(() => classifyClovaError({ status: 500 })).toThrow('server error');
	});

	it('should throw TransientError for 503 status', () => {
		expect(() => classifyClovaError({ status: 503 })).toThrow(TransientError);
		expect(() => classifyClovaError({ status: 503 })).toThrow('server error');
	});

	it('should throw TransientError for network errors (no status)', () => {
		const err = new Error('fetch failed');
		expect(() => classifyClovaError(err)).toThrow(TransientError);
		expect(() => classifyClovaError(err)).toThrow('fetch failed');
	});

	it('should throw TransientError with HTTP status message for unknown status codes', () => {
		expect(() => classifyClovaError({ status: 502 })).toThrow(TransientError);
		expect(() => classifyClovaError({ status: 502 })).toThrow('HTTP error (status 502)');
	});
});

describe('classifyClovaResultError', () => {
	it('should throw DataError with message', () => {
		expect(() => classifyClovaResultError('FAILED', 'Audio format not supported')).toThrow(DataError);
		expect(() => classifyClovaResultError('FAILED', 'Audio format not supported')).toThrow('Audio format not supported');
	});

	it('should throw DataError with result as fallback when message is empty', () => {
		expect(() => classifyClovaResultError('ERROR', '')).toThrow(DataError);
		expect(() => classifyClovaResultError('ERROR', '')).toThrow('ERROR');
	});
});
