import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateNote, generateFilename } from '../../src/note/note-generator';
import type { SummaryResult, TranscriptionResult, MeetingMetadata } from '../../src/providers/types';

function createMockSummaryResult(overrides?: Partial<SummaryResult>): SummaryResult {
	return {
		version: 1,
		provider: 'openai',
		model: 'gpt-4o-mini',
		summary: '## Summary\n\nThe team discussed sprint progress.\n\n## Key Discussion Points\n\n- **Sprint Progress:** All on track.',
		metadata: {
			title: 'Weekly Standup',
			date: '2026-03-16',
			participants: ['Alice', 'Bob'],
			topics: ['sprint progress'],
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
			{ start: 0, end: 1800, text: 'Meeting content.' },
			{ start: 1800, end: 3000, text: 'More content.' },
		],
		fullText: 'Meeting content. More content.',
		createdAt: '2026-03-16T10:00:00Z',
		...overrides,
	};
}

describe('generateNote', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('assembles frontmatter + body into complete markdown', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: '_attachments/audio/2026-03-16-recording.webm',
		});

		// Should start with frontmatter
		expect(result.startsWith('---\n')).toBe(true);
		// Should contain closing frontmatter delimiter followed by blank line
		expect(result).toContain('---\n\n');
		// Should contain the summary body
		expect(result).toContain('## Summary');
		expect(result).toContain('The team discussed sprint progress.');
	});

	it('has blank line between frontmatter and body', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		// Find the closing --- and check there's a blank line after
		const parts = result.split('---');
		// parts[0] = '' (before first ---), parts[1] = frontmatter content, parts[2] = rest
		expect(parts.length).toBeGreaterThanOrEqual(3);
		expect(parts[2]!.startsWith('\n\n')).toBe(true);
	});

	it('includes body content from summaryResult.summary', () => {
		const customBody = '## Custom Summary\n\nThis is custom content.';
		const result = generateNote({
			summaryResult: createMockSummaryResult({ summary: customBody }),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		expect(result).toContain(customBody);
	});
});

describe('generateFilename', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('generates filename with date and title', () => {
		const metadata: MeetingMetadata = {
			title: 'Weekly Standup',
			date: '2026-03-16',
		};

		const result = generateFilename(metadata);
		expect(result).toBe('2026-03-16 Weekly Standup.md');
	});

	it('sanitizes invalid filename characters', () => {
		const metadata: MeetingMetadata = {
			title: 'Meeting: Discussion & Q/A "Session"',
			date: '2026-03-16',
		};

		const result = generateFilename(metadata);
		expect(result).toBe('2026-03-16 Meeting- Discussion & Q-A -Session-.md');
	});

	it('handles missing metadata with fallback filename', () => {
		const result = generateFilename(undefined);
		expect(result).toBe('2026-03-16 Untitled Meeting.md');
	});

	it('uses current date when metadata.date is undefined', () => {
		const metadata: MeetingMetadata = {
			title: 'Team Sync',
			date: undefined,
		};

		const result = generateFilename(metadata);
		expect(result).toBe('2026-03-16 Team Sync.md');
	});

	it('uses "Untitled Meeting" when metadata.title is undefined', () => {
		const metadata: MeetingMetadata = {
			date: '2026-03-16',
			title: undefined,
		};

		const result = generateFilename(metadata);
		expect(result).toBe('2026-03-16 Untitled Meeting.md');
	});

	it('handles Korean titles', () => {
		const metadata: MeetingMetadata = {
			title: '팀 주간회의',
			date: '2026-03-16',
		};

		const result = generateFilename(metadata);
		expect(result).toBe('2026-03-16 팀 주간회의.md');
	});
});
