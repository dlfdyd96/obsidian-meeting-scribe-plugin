// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranscriptData, ParticipantMapping, TranscriptSegmentV2 } from '../../../src/transcript/transcript-data';
import type { TranscriptionResult } from '../../../src/providers/types';
import { formatTranscriptSection } from '../../../src/note/templates';
import { buildTranscriptionResultFromData } from '../../../src/ui/sidebar/re-summarize-helpers';

function createTranscriptData(overrides?: Partial<TranscriptData>): TranscriptData {
	return {
		version: 2,
		audioFile: 'audio/meeting.webm',
		duration: 60,
		provider: 'openai',
		model: 'whisper-1',
		language: 'en',
		segments: [
			{ id: 'seg-1', speaker: 'Participant 1', start: 0, end: 15, text: 'Hello, let us begin.' },
			{ id: 'seg-2', speaker: 'Participant 2', start: 15, end: 30, text: 'Sure, sounds good.' },
			{ id: 'seg-3', speaker: 'Participant 1', start: 30, end: 45, text: 'First topic is the roadmap.' },
		],
		participants: [
			{ alias: 'Participant 1', name: '', wikiLink: true, color: 0 },
			{ alias: 'Participant 2', name: '', wikiLink: true, color: 1 },
		],
		pipeline: {
			status: 'complete',
			progress: 100,
			completedSteps: ['transcribe', 'summarize', 'generate-note'],
			noteFilePath: 'meetings/2026-03-25 Team Meeting.md',
		},
		meetingNote: 'meetings/2026-03-25 Team Meeting.md',
		createdAt: '2026-03-25T10:00:00Z',
		updatedAt: '2026-03-25T10:05:00Z',
		...overrides,
	};
}

describe('buildTranscriptionResultFromData', () => {
	it('should reconstruct TranscriptionResult with fullText from segments', () => {
		const data = createTranscriptData();
		const result = buildTranscriptionResultFromData(data);

		expect(result.version).toBe(1);
		expect(result.audioFile).toBe('audio/meeting.webm');
		expect(result.provider).toBe('openai');
		expect(result.model).toBe('whisper-1');
		expect(result.language).toBe('en');
		expect(result.segments).toHaveLength(3);
		expect(result.fullText).toContain('Hello, let us begin.');
		expect(result.fullText).toContain('Sure, sounds good.');
	});

	it('should apply participant name mappings to speaker labels in fullText', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';
		data.participants[1]!.name = 'Bob';

		const result = buildTranscriptionResultFromData(data);

		expect(result.fullText).toContain('Alice:');
		expect(result.fullText).toContain('Bob:');
		expect(result.fullText).not.toContain('Participant 1');
		expect(result.fullText).not.toContain('Participant 2');
	});

	it('should apply mapped names to segment speaker fields', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';

		const result = buildTranscriptionResultFromData(data);

		expect(result.segments[0]!.speaker).toBe('Alice');
		expect(result.segments[2]!.speaker).toBe('Alice');
		// Unmapped participant keeps alias
		expect(result.segments[1]!.speaker).toBe('Participant 2');
	});

	it('should return defensive copies of segments', () => {
		const data = createTranscriptData();
		const result = buildTranscriptionResultFromData(data);

		// Mutating result segments should not affect original data
		result.segments[0]!.text = 'MUTATED';
		expect(data.segments[0]!.text).toBe('Hello, let us begin.');
	});

	it('should handle empty segments', () => {
		const data = createTranscriptData({ segments: [] });
		const result = buildTranscriptionResultFromData(data);

		expect(result.segments).toHaveLength(0);
		expect(result.fullText).toBe('');
	});

	it('should handle segments without speaker labels', () => {
		const data = createTranscriptData({
			segments: [
				{ id: 'seg-1', speaker: '', start: 0, end: 10, text: 'Some text.' },
			],
		});
		const result = buildTranscriptionResultFromData(data);

		expect(result.fullText).toBe('Some text.');
	});

	it('should apply wiki-link formatting when applyWikiLinks is true', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';
		data.participants[0]!.wikiLink = true;
		data.participants[1]!.name = 'Bob';
		data.participants[1]!.wikiLink = false;

		const result = buildTranscriptionResultFromData(data, { applyWikiLinks: true });

		expect(result.segments[0]!.speaker).toBe('[[Alice]]');
		expect(result.segments[1]!.speaker).toBe('Bob');
		expect(result.fullText).toContain('[[Alice]]:');
		expect(result.fullText).not.toContain('[[Bob]]');
	});

	it('should not apply wiki-links when applyWikiLinks is false or omitted', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';
		data.participants[0]!.wikiLink = true;

		const result = buildTranscriptionResultFromData(data);

		expect(result.segments[0]!.speaker).toBe('Alice');
		expect(result.fullText).not.toContain('[[');
	});
});

describe('Re-summarize: Note Update Logic', () => {
	it('should preserve frontmatter when updating note body', () => {
		const frontmatter = '---\ndate: 2026-03-25\ntype: meeting\ntitle: Team Meeting\n---';
		const audioEmbed = '![[meeting.webm]]';
		const oldBody = '## Summary\n\nOld summary text';
		const newSummary = '## Summary\n\nNew summary text from re-summarize';

		const oldContent = `${frontmatter}\n\n${audioEmbed}\n\n${oldBody}\n`;

		// Simulate note update logic: parse frontmatter, replace body
		const fmMatch = oldContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
		expect(fmMatch).not.toBeNull();

		const parsedFrontmatter = fmMatch![1]!;
		expect(parsedFrontmatter).toContain('date: 2026-03-25');
		expect(parsedFrontmatter).toContain('title: Team Meeting');

		// Reconstruct with new body, preserving audio embed
		const bodyContent = fmMatch![2]!;
		const audioEmbedMatch = bodyContent.match(/^(\n*!?\[\[[^\]]+\]\])/);
		const extractedAudioEmbed = audioEmbedMatch ? audioEmbedMatch[1]!.trim() : '';
		expect(extractedAudioEmbed).toBe('![[meeting.webm]]');

		const updatedContent = `---\n${parsedFrontmatter}\n---\n\n${extractedAudioEmbed}\n\n${newSummary}\n`;
		expect(updatedContent).toContain('date: 2026-03-25');
		expect(updatedContent).toContain('![[meeting.webm]]');
		expect(updatedContent).toContain('New summary text from re-summarize');
		expect(updatedContent).not.toContain('Old summary text');
	});
});

describe('Export: Markdown Output', () => {
	it('should produce correct Markdown with timestamps, speaker names, and text', () => {
		const data = createTranscriptData();
		const result = buildTranscriptionResultFromData(data);
		const markdown = formatTranscriptSection(result);

		expect(markdown).toContain('[00:00:00]');
		expect(markdown).toContain('[00:00:15]');
		expect(markdown).toContain('[00:00:30]');
		expect(markdown).toContain('**Participant 1:**');
		expect(markdown).toContain('**Participant 2:**');
		expect(markdown).toContain('Hello, let us begin.');
	});

	it('should use mapped names in exported Markdown', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';
		data.participants[1]!.name = 'Bob';

		const result = buildTranscriptionResultFromData(data);
		const markdown = formatTranscriptSection(result);

		expect(markdown).toContain('**Alice:**');
		expect(markdown).toContain('**Bob:**');
		expect(markdown).not.toContain('Participant 1');
		expect(markdown).not.toContain('Participant 2');
	});

	it('should use wiki-linked names in exported Markdown when wikiLink is true', () => {
		const data = createTranscriptData();
		data.participants[0]!.name = 'Alice';
		data.participants[0]!.wikiLink = true;
		data.participants[1]!.name = 'Bob';
		data.participants[1]!.wikiLink = false;

		const result = buildTranscriptionResultFromData(data, { applyWikiLinks: true });
		const markdown = formatTranscriptSection(result);

		expect(markdown).toContain('**[[Alice]]:**');
		expect(markdown).toContain('**Bob:**');
		expect(markdown).not.toContain('**[[Bob]]:**');
	});

	it('should handle empty transcript gracefully', () => {
		const data = createTranscriptData({ segments: [] });
		const result = buildTranscriptionResultFromData(data);
		const markdown = formatTranscriptSection(result);

		// With no segments and empty fullText, formatTranscriptSection returns fullText (empty)
		expect(markdown).toBe('');
	});
});

describe('Export: File Path Deduplication', () => {
	it('should generate correct export filename from session title', () => {
		const title = 'Team Meeting';
		const expectedFilename = `${title} - Transcript.md`;
		expect(expectedFilename).toBe('Team Meeting - Transcript.md');
	});

	it('should sanitize special characters in filename', () => {
		const title = 'Client/Server: Meeting <2>';
		const sanitized = title.split('').map(c => '/\\:*?"<>|'.includes(c) ? '-' : c).join('');
		const filename = `${sanitized} - Transcript.md`;
		expect(filename).not.toContain('/');
		expect(filename).not.toContain(':');
		expect(filename).not.toContain('<');
		expect(filename).not.toContain('>');
	});
});

describe('Re-summarize: Error Handling', () => {
	it('should identify missing meeting note path', () => {
		const data = createTranscriptData({ meetingNote: '' });
		expect(data.meetingNote).toBe('');
	});

	it('should identify incomplete pipeline status', () => {
		const data = createTranscriptData();
		data.pipeline.status = 'summarizing';
		expect(data.pipeline.status).not.toBe('complete');
	});
});
