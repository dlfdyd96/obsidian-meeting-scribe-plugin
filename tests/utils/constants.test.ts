import { describe, it, expect } from 'vitest';
import {
	MAX_RETRY_COUNT,
	MAX_CHUNK_SIZE_BYTES,
	RETRY_BASE_DELAY_MS,
	PLUGIN_ID,
	PLUGIN_NAME,
	SUPPORTED_AUDIO_FORMATS,
	PROVIDER_MAX_DURATION,
	getMaxDuration,
} from '../../src/constants';

describe('Constants', () => {
	it('MAX_RETRY_COUNT should be 3', () => {
		expect(MAX_RETRY_COUNT).toBe(3);
	});

	it('MAX_CHUNK_SIZE_BYTES should be 25MB', () => {
		expect(MAX_CHUNK_SIZE_BYTES).toBe(25 * 1024 * 1024);
	});

	it('RETRY_BASE_DELAY_MS should be 1000', () => {
		expect(RETRY_BASE_DELAY_MS).toBe(1000);
	});

	it('PLUGIN_ID should be "meeting-scribe"', () => {
		expect(PLUGIN_ID).toBe('meeting-scribe');
	});

	it('PLUGIN_NAME should be "Meeting Scribe"', () => {
		expect(PLUGIN_NAME).toBe('Meeting Scribe');
	});

	it('SUPPORTED_AUDIO_FORMATS should contain all OpenAI-supported formats', () => {
		expect(SUPPORTED_AUDIO_FORMATS).toEqual(['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga']);
	});

	it('SUPPORTED_AUDIO_FORMATS should include webm (recorder output format)', () => {
		expect(SUPPORTED_AUDIO_FORMATS).toContain('webm');
	});

	describe('PROVIDER_MAX_DURATION', () => {
		it('should define limit for OpenAI diarize model', () => {
			expect(PROVIDER_MAX_DURATION['openai:gpt-4o-transcribe-diarize']).toBe(1400);
		});

		it('should define limit for CLOVA sync mode', () => {
			expect(PROVIDER_MAX_DURATION['clova:clova-sync']).toBe(7200);
		});

		it('should define limit for Google batch mode models', () => {
			expect(PROVIDER_MAX_DURATION['google:chirp_3']).toBe(28800);
			expect(PROVIDER_MAX_DURATION['google:chirp_2']).toBe(28800);
		});
	});

	describe('getMaxDuration', () => {
		it('should return duration limit for provider:model with a limit', () => {
			expect(getMaxDuration('openai', 'gpt-4o-transcribe-diarize')).toBe(1400);
		});

		it('should return null for provider:model with no limit', () => {
			expect(getMaxDuration('openai', 'gpt-4o-mini-transcribe')).toBeNull();
			expect(getMaxDuration('openai', 'whisper-1')).toBeNull();
		});

		it('should return limit for CLOVA provider', () => {
			expect(getMaxDuration('clova', 'clova-sync')).toBe(7200);
		});

		it('should return limit for Google provider', () => {
			expect(getMaxDuration('google', 'chirp_3')).toBe(28800);
		});

		it('should return null for unknown provider:model', () => {
			expect(getMaxDuration('unknown', 'unknown-model')).toBeNull();
		});
	});
});
