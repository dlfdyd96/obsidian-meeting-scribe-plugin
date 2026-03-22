import { describe, it, expect } from 'vitest';
import { classifyGeminiError } from '../../src/providers/gemini-error-utils';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';

describe('classifyGeminiError', () => {
	it('should throw ConfigError for 401 status', () => {
		expect(() => classifyGeminiError({ status: 401 })).toThrow(ConfigError);
		expect(() => classifyGeminiError({ status: 401 })).toThrow('Invalid Gemini API key');
	});

	it('should throw ConfigError for 403 status', () => {
		expect(() => classifyGeminiError({ status: 403 })).toThrow(ConfigError);
		expect(() => classifyGeminiError({ status: 403 })).toThrow('Invalid Gemini API key');
	});

	it('should throw DataError for 400 status', () => {
		expect(() => classifyGeminiError({ status: 400, message: 'bad input' })).toThrow(DataError);
		expect(() => classifyGeminiError({ status: 400, message: 'bad input' })).toThrow('bad input');
	});

	it('should throw DataError for 400 without message', () => {
		expect(() => classifyGeminiError({ status: 400 })).toThrow(DataError);
		expect(() => classifyGeminiError({ status: 400 })).toThrow('Bad request');
	});

	it('should throw TransientError for 429 status', () => {
		expect(() => classifyGeminiError({ status: 429 })).toThrow(TransientError);
		expect(() => classifyGeminiError({ status: 429 })).toThrow('Rate limited');
	});

	it('should throw TransientError for 500 status', () => {
		expect(() => classifyGeminiError({ status: 500 })).toThrow(TransientError);
		expect(() => classifyGeminiError({ status: 500 })).toThrow('server error');
	});

	it('should throw TransientError for 502 status', () => {
		expect(() => classifyGeminiError({ status: 502 })).toThrow(TransientError);
	});

	it('should throw TransientError for 503 status', () => {
		expect(() => classifyGeminiError({ status: 503 })).toThrow(TransientError);
	});

	it('should throw TransientError for unknown HTTP status', () => {
		expect(() => classifyGeminiError({ status: 418 })).toThrow(TransientError);
		expect(() => classifyGeminiError({ status: 418 })).toThrow('status 418');
	});

	it('should throw TransientError for network errors (no status)', () => {
		expect(() => classifyGeminiError(new Error('fetch failed'))).toThrow(TransientError);
		expect(() => classifyGeminiError(new Error('fetch failed'))).toThrow('fetch failed');
	});

	it('should rethrow ConfigError without re-classifying', () => {
		const original = new ConfigError('original');
		expect(() => classifyGeminiError(original)).toThrow(original);
	});

	it('should rethrow TransientError without re-classifying', () => {
		const original = new TransientError('original');
		expect(() => classifyGeminiError(original)).toThrow(original);
	});

	it('should rethrow DataError without re-classifying', () => {
		const original = new DataError('original');
		expect(() => classifyGeminiError(original)).toThrow(original);
	});
});
