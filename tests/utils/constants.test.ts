import { describe, it, expect } from 'vitest';
import {
	MAX_RETRY_COUNT,
	MAX_CHUNK_SIZE_BYTES,
	RETRY_BASE_DELAY_MS,
	PLUGIN_ID,
	PLUGIN_NAME,
	SUPPORTED_AUDIO_FORMATS,
	DIARIZE_MAX_DURATION_SECONDS,
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

	it('DIARIZE_MAX_DURATION_SECONDS should be 1400', () => {
		expect(DIARIZE_MAX_DURATION_SECONDS).toBe(1400);
	});
});
