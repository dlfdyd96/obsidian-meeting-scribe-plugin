import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildFrontmatter } from '../../src/note/frontmatter-builder';
import type { SummaryResult, TranscriptionResult } from '../../src/providers/types';

function createMockSummaryResult(overrides?: Partial<SummaryResult>): SummaryResult {
	return {
		version: 1,
		provider: 'openai',
		model: 'gpt-4o-mini',
		summary: '## Summary\n\nTest summary content.',
		metadata: {
			title: 'Weekly Standup',
			date: '2026-03-16',
			participants: ['Alice', 'Bob'],
			topics: ['sprint progress', 'blockers'],
			tags: ['meeting', 'standup'],
		},
		createdAt: '2026-03-16T10:00:00Z',
		...overrides,
	};
}

function createMockTranscriptionResult(overrides?: Partial<TranscriptionResult>): TranscriptionResult {
	return {
		version: 1,
		audioFile: '_attachments/audio/2026-03-16-recording.webm',
		provider: 'openai',
		model: 'gpt-4o-mini-transcribe',
		language: 'en',
		segments: [
			{ start: 0, end: 300, text: 'First part of the meeting.' },
			{ start: 300, end: 1800, text: 'Second part of the meeting.' },
			{ start: 1800, end: 3000, text: 'Final part of the meeting.' },
		],
		fullText: 'First part of the meeting. Second part of the meeting. Final part of the meeting.',
		createdAt: '2026-03-16T10:00:00Z',
		...overrides,
	};
}

describe('buildFrontmatter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('generates correct YAML with all metadata fields present', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: '_attachments/audio/2026-03-16-recording.webm',
		});

		expect(result).toContain('---');
		expect(result).toContain('date: 2026-03-16');
		expect(result).toContain('type: meeting');
		expect(result).toContain('title: Weekly Standup');
		expect(result).toContain('  - Alice');
		expect(result).toContain('  - Bob');
		expect(result).toContain('  - meeting');
		expect(result).toContain('  - standup');
		expect(result).toContain('  - sprint progress');
		expect(result).toContain('  - blockers');
		expect(result).toContain('duration: 50');
		expect(result).toContain('audio: _attachments/audio/2026-03-16-recording.webm');
		expect(result).toContain('created_by: meeting-scribe');
	});

	it('wraps output in --- delimiters', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: '_attachments/audio/2026-03-16-recording.webm',
		});

		expect(result.startsWith('---\n')).toBe(true);
		expect(result.endsWith('\n---')).toBe(true);
	});

	it('falls back to current date when metadata.date is undefined', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: { title: 'Test', date: undefined },
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('date: 2026-03-16');
	});

	it('falls back to "Untitled Meeting" when metadata.title is undefined', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: { date: '2026-03-16', title: undefined },
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('title: Untitled Meeting');
	});

	it('falls back to ["meeting"] when metadata.tags is undefined', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: { title: 'Test', tags: undefined },
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('tags:');
		expect(result).toContain('  - meeting');
	});

	it('falls back to empty arrays for undefined participants and topics', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: { title: 'Test', participants: undefined, topics: undefined },
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('participants: []');
		expect(result).toContain('topics: []');
	});

	it('computes duration from last segment end time', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult({
				segments: [
					{ start: 0, end: 120, text: 'Short meeting.' },
					{ start: 120, end: 2700, text: 'End of meeting.' },
				],
			}),
			audioFilePath: 'test/audio.webm',
		});

		// 2700 seconds = 45 minutes
		expect(result).toContain('duration: 45');
	});

	it('handles zero segments with duration 0', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult({ segments: [] }),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('duration: 0');
	});

	it('handles metadata being entirely undefined', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({ metadata: undefined }),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('date: 2026-03-16');
		expect(result).toContain('title: Untitled Meeting');
		expect(result).toContain('participants: []');
		expect(result).toContain('tags:');
		expect(result).toContain('  - meeting');
		expect(result).toContain('topics: []');
	});

	it('quotes title containing special YAML characters', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: { title: 'Meeting: Discussion & Planning' },
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain("title: 'Meeting: Discussion & Planning'");
	});

	it('quotes array items containing special YAML characters', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult({
				metadata: {
					title: 'Test',
					date: '2026-03-16',
					participants: ['Bob: Manager', 'Alice & Co'],
					topics: ['Q&A: Next Steps'],
					tags: ['meeting'],
				},
			}),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain("  - 'Bob: Manager'");
		expect(result).toContain("  - 'Alice & Co'");
		expect(result).toContain("  - 'Q&A: Next Steps'");
	});

	it('renders non-empty arrays in block style', () => {
		const result = buildFrontmatter({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain('participants:\n  - Alice\n  - Bob');
		expect(result).toContain('tags:\n  - meeting\n  - standup');
		expect(result).toContain('topics:\n  - sprint progress\n  - blockers');
	});
});
