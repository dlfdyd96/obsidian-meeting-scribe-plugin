import { describe, it, expect } from 'vitest';
import {
	MAX_RETRY_COUNT,
	DEFAULT_CHUNK_DURATION_SECONDS,
	RETRY_BASE_DELAY_MS,
	PLUGIN_ID,
	PLUGIN_NAME,
} from '../../src/constants';

describe('Constants', () => {
	it('MAX_RETRY_COUNT should be 3', () => {
		expect(MAX_RETRY_COUNT).toBe(3);
	});

	it('DEFAULT_CHUNK_DURATION_SECONDS should be 600', () => {
		expect(DEFAULT_CHUNK_DURATION_SECONDS).toBe(600);
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
});
