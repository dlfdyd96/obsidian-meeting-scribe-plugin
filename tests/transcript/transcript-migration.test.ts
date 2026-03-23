import { describe, it, expect } from 'vitest';
import { migrateV1ToV2, transcriptionResultToV2 } from '../../src/transcript/transcript-migration';
import type { TranscriptionResult } from '../../src/providers/types';

describe('migrateV1ToV2', () => {
	it('should convert v1 record to v2 TranscriptData', () => {
		const v1: Record<string, unknown> = {
			version: 1,
			audioFile: 'audio/meeting.m4a',
			provider: 'openai',
			model: 'gpt-4o-mini-transcribe',
			language: 'ko',
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 10, text: 'Hello' },
				{ speaker: 'Participant 2', start: 10, end: 20, text: 'Hi' },
				{ speaker: 'Participant 1', start: 20, end: 30, text: 'Bye' },
			],
			fullText: 'Hello Hi Bye',
			createdAt: '2026-03-24T10:00:00.000Z',
		};

		const result = migrateV1ToV2(v1);

		expect(result.version).toBe(2);
		expect(result.audioFile).toBe('audio/meeting.m4a');
		expect(result.provider).toBe('openai');
		expect(result.model).toBe('gpt-4o-mini-transcribe');
		expect(result.language).toBe('ko');
		expect(result.createdAt).toBe('2026-03-24T10:00:00.000Z');
	});

	it('should generate unique IDs for each segment', () => {
		const v1: Record<string, unknown> = {
			version: 1,
			audioFile: '',
			provider: '',
			model: '',
			language: '',
			segments: [
				{ speaker: 'A', start: 0, end: 5, text: 'one' },
				{ speaker: 'B', start: 5, end: 10, text: 'two' },
				{ speaker: 'A', start: 10, end: 15, text: 'three' },
			],
			fullText: '',
			createdAt: '',
		};

		const result = migrateV1ToV2(v1);

		expect(result.segments).toHaveLength(3);
		const ids = result.segments.map(s => s.id);
		expect(new Set(ids).size).toBe(3);
		ids.forEach(id => {
			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
		});
	});

	it('should extract unique participants in order of appearance', () => {
		const v1: Record<string, unknown> = {
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 5, text: 'a' },
				{ speaker: 'Participant 2', start: 5, end: 10, text: 'b' },
				{ speaker: 'Participant 1', start: 10, end: 15, text: 'c' },
				{ speaker: 'Participant 3', start: 15, end: 20, text: 'd' },
			],
		};

		const result = migrateV1ToV2(v1);

		expect(result.participants).toHaveLength(3);
		expect(result.participants[0]).toEqual({ alias: 'Participant 1', name: '', wikiLink: false, color: 0 });
		expect(result.participants[1]).toEqual({ alias: 'Participant 2', name: '', wikiLink: false, color: 1 });
		expect(result.participants[2]).toEqual({ alias: 'Participant 3', name: '', wikiLink: false, color: 2 });
	});

	it('should set pipeline to complete state', () => {
		const result = migrateV1ToV2({ segments: [] });

		expect(result.pipeline.status).toBe('complete');
		expect(result.pipeline.progress).toBe(100);
		expect(result.pipeline.completedSteps).toEqual(['transcribe', 'summarize', 'generate']);
	});

	it('should calculate duration from max segment end time', () => {
		const v1: Record<string, unknown> = {
			segments: [
				{ start: 0, end: 100, text: 'a' },
				{ start: 100, end: 300, text: 'b' },
				{ start: 300, end: 250, text: 'c' },
			],
		};

		const result = migrateV1ToV2(v1);
		expect(result.duration).toBe(300);
	});

	it('should handle empty segments array', () => {
		const result = migrateV1ToV2({ segments: [] });

		expect(result.segments).toHaveLength(0);
		expect(result.participants).toHaveLength(0);
		expect(result.duration).toBe(0);
	});

	it('should handle segments with missing speaker field', () => {
		const v1: Record<string, unknown> = {
			segments: [
				{ start: 0, end: 5, text: 'no speaker' },
				{ speaker: '', start: 5, end: 10, text: 'empty speaker' },
				{ speaker: 'Participant 1', start: 10, end: 15, text: 'has speaker' },
			],
		};

		const result = migrateV1ToV2(v1);

		expect(result.segments).toHaveLength(3);
		expect(result.segments[0].speaker).toBe('');
		expect(result.segments[1].speaker).toBe('');
		expect(result.segments[2].speaker).toBe('Participant 1');
		// Only "Participant 1" should be in participants (empty speakers excluded)
		expect(result.participants).toHaveLength(1);
		expect(result.participants[0].alias).toBe('Participant 1');
	});

	it('should set meetingNote to empty string', () => {
		const result = migrateV1ToV2({ segments: [] });
		expect(result.meetingNote).toBe('');
	});

	it('should set updatedAt timestamp', () => {
		const before = new Date().toISOString();
		const result = migrateV1ToV2({ segments: [] });
		expect(result.updatedAt >= before).toBe(true);
	});
});

describe('transcriptionResultToV2', () => {
	function makeTranscriptionResult(overrides: Partial<TranscriptionResult> = {}): TranscriptionResult {
		return {
			version: 1,
			audioFile: 'audio/test.m4a',
			provider: 'gemini',
			model: 'gemini-2.5-flash',
			language: 'ko',
			segments: [
				{ speaker: 'Participant 1', start: 30, end: 120, text: 'Hello' },
				{ speaker: 'Participant 2', start: 120, end: 240, text: 'Hi' },
			],
			fullText: 'Hello\nHi',
			createdAt: '2026-03-24T10:00:00.000Z',
			...overrides,
		};
	}

	it('should convert TranscriptionResult to v2 format', () => {
		const result = transcriptionResultToV2(makeTranscriptionResult(), 'audio/meeting.m4a');

		expect(result.version).toBe(2);
		expect(result.audioFile).toBe('audio/meeting.m4a');
		expect(result.provider).toBe('gemini');
		expect(result.model).toBe('gemini-2.5-flash');
		expect(result.language).toBe('ko');
	});

	it('should set pipeline status to transcribing with transcribe completed', () => {
		const result = transcriptionResultToV2(makeTranscriptionResult(), 'audio/test.m4a');

		expect(result.pipeline.status).toBe('transcribing');
		expect(result.pipeline.progress).toBe(50);
		expect(result.pipeline.completedSteps).toEqual(['transcribe']);
	});

	it('should generate unique segment IDs', () => {
		const result = transcriptionResultToV2(makeTranscriptionResult(), 'audio/test.m4a');

		expect(result.segments).toHaveLength(2);
		expect(result.segments[0].id).toBeTruthy();
		expect(result.segments[1].id).toBeTruthy();
		expect(result.segments[0].id).not.toBe(result.segments[1].id);
	});

	it('should extract participants from segments', () => {
		const result = transcriptionResultToV2(makeTranscriptionResult(), 'audio/test.m4a');

		expect(result.participants).toHaveLength(2);
		expect(result.participants[0]).toEqual({ alias: 'Participant 1', name: '', wikiLink: false, color: 0 });
		expect(result.participants[1]).toEqual({ alias: 'Participant 2', name: '', wikiLink: false, color: 1 });
	});

	it('should calculate duration from segment end times', () => {
		const result = transcriptionResultToV2(makeTranscriptionResult(), 'audio/test.m4a');
		expect(result.duration).toBe(240);
	});

	it('should handle empty segments', () => {
		const result = transcriptionResultToV2(
			makeTranscriptionResult({ segments: [], fullText: '' }),
			'audio/test.m4a',
		);

		expect(result.segments).toHaveLength(0);
		expect(result.participants).toHaveLength(0);
		expect(result.duration).toBe(0);
	});
});
