import { describe, it, expect } from 'vitest';
import {
	getDefaultPreset,
	buildUserPrompt,
	buildLanguageInstruction,
	formatSummaryBody,
	formatTranscriptSection,
	formatTimestamp,
	type SummaryPreset,
	type LLMNoteOutput,
} from '../../src/note/templates';
import type { TranscriptionResult } from '../../src/providers/types';

describe('templates', () => {
	describe('SummaryPreset', () => {
		it('should return a valid default preset', () => {
			const preset = getDefaultPreset();

			expect(preset.id).toBe('default');
			expect(preset.name).toBe('Meeting Notes');
			expect(preset.description).toBeTruthy();
			expect(preset.systemPrompt).toBeTruthy();
			expect(preset.userPromptTemplate).toContain('{{transcript}}');
		});

		it('should have system prompt that requests JSON output with metadata and summary', () => {
			const preset = getDefaultPreset();

			expect(preset.systemPrompt).toContain('metadata');
			expect(preset.systemPrompt).toContain('summary');
			expect(preset.systemPrompt).toContain('JSON');
		});

		it('should have system prompt that requests structured sections', () => {
			const preset = getDefaultPreset();

			expect(preset.systemPrompt).toContain('Key Discussion Points');
			expect(preset.systemPrompt).toContain('Decisions');
			expect(preset.systemPrompt).toContain('Action Items');
		});

		it('should have system prompt that handles multi-language transcripts', () => {
			const preset = getDefaultPreset();

			expect(preset.systemPrompt).toContain('language');
		});

		it('should instruct LLM to use [[wiki-link]] format for speaker references', () => {
			const preset = getDefaultPreset();

			expect(preset.systemPrompt).toContain('[[wiki-link]]');
		});
	});

	describe('buildUserPrompt', () => {
		it('should replace {{transcript}} placeholder with actual transcript', () => {
			const template = 'Here is the transcript:\n\n{{transcript}}\n\nAnalyze it.';
			const transcript = 'Alice: Hello everyone.';

			const result = buildUserPrompt(template, transcript);

			expect(result).toBe('Here is the transcript:\n\nAlice: Hello everyone.\n\nAnalyze it.');
			expect(result).not.toContain('{{transcript}}');
		});

		it('should handle empty transcript', () => {
			const template = '{{transcript}}';
			const result = buildUserPrompt(template, '');

			expect(result).toBe('');
		});

		it('should handle transcript with special characters', () => {
			const template = 'Transcript: {{transcript}}';
			const transcript = 'Price is $100. Use regex /test/g.';

			const result = buildUserPrompt(template, transcript);

			expect(result).toBe('Transcript: Price is $100. Use regex /test/g.');
		});

		it('should replace all {{transcript}} occurrences', () => {
			const template = '{{transcript}} and {{transcript}}';
			const transcript = 'hello';

			const result = buildUserPrompt(template, transcript);

			expect(result).toBe('hello and hello');
		});
	});

	describe('formatSummaryBody', () => {
		it('should format a complete LLMNoteOutput into markdown sections', () => {
			const output: LLMNoteOutput = {
				metadata: {
					title: 'Weekly Standup',
					date: '2026-03-16',
					participants: ['Alice', 'Bob'],
					topics: ['sprint progress'],
					tags: ['meeting', 'standup'],
				},
				summary: 'The team discussed sprint progress and upcoming tasks.',
				key_discussion_points: [
					{ topic: 'Sprint Progress', summary: 'All tasks on track.' },
					{ topic: 'Blockers', summary: 'No major blockers identified.' },
				],
				decisions: [
					'Adopt new logging format starting next sprint',
					'Defer auth refactoring to Sprint 13',
				],
				action_items: [
					{ assignee: 'Alice', task: 'Update the sprint board', deadline: 'EOD Friday' },
					{ assignee: 'Bob', task: 'Review PR #42', deadline: null },
				],
				discussion_notes: 'Alice opened the meeting by reviewing the sprint board.',
			};

			const result = formatSummaryBody(output);

			expect(result).toContain('## Summary');
			expect(result).toContain('The team discussed sprint progress and upcoming tasks.');
			expect(result).toContain('## Key Discussion Points');
			expect(result).toContain('**Sprint Progress:**');
			expect(result).toContain('All tasks on track.');
			expect(result).toContain('**Blockers:**');
			expect(result).toContain('## Decisions');
			expect(result).toContain('- Adopt new logging format starting next sprint');
			expect(result).toContain('## Action Items');
			expect(result).toContain('- [ ] @Alice: Update the sprint board (by EOD Friday)');
			expect(result).toContain('- [ ] @Bob: Review PR #42');
			expect(result).toContain('## Discussion Notes');
			expect(result).toContain('Alice opened the meeting by reviewing the sprint board.');
		});

		it('should handle empty arrays gracefully', () => {
			const output: LLMNoteOutput = {
				metadata: {
					title: 'Quick Sync',
					date: null,
					participants: [],
					topics: [],
					tags: ['meeting'],
				},
				summary: 'Brief sync call.',
				key_discussion_points: [],
				decisions: [],
				action_items: [],
				discussion_notes: '',
			};

			const result = formatSummaryBody(output);

			expect(result).toContain('## Summary');
			expect(result).toContain('Brief sync call.');
			// Empty sections should still have headers but no content
			expect(result).not.toContain('undefined');
			expect(result).not.toContain('null');
		});

		it('should handle action items without deadlines', () => {
			const output: LLMNoteOutput = {
				metadata: {
					title: 'Test',
					date: null,
					participants: [],
					topics: [],
					tags: [],
				},
				summary: 'Test meeting.',
				key_discussion_points: [],
				decisions: [],
				action_items: [
					{ assignee: 'Alice', task: 'Do something', deadline: null },
				],
				discussion_notes: '',
			};

			const result = formatSummaryBody(output);

			expect(result).toContain('- [ ] @Alice: Do something');
			expect(result).not.toContain('(by null)');
			expect(result).not.toContain('(by )');
		});
	});

	describe('buildLanguageInstruction', () => {
		it('should return empty string for auto', () => {
			expect(buildLanguageInstruction('auto')).toBe('');
		});

		it('should return Korean instruction for ko', () => {
			const result = buildLanguageInstruction('ko');
			expect(result).toContain('Korean');
			expect(result).toContain('한국어');
		});

		it('should return English instruction for en', () => {
			const result = buildLanguageInstruction('en');
			expect(result).toContain('English');
		});

		it('should return Japanese instruction for ja', () => {
			const result = buildLanguageInstruction('ja');
			expect(result).toContain('Japanese');
			expect(result).toContain('日本語');
		});

		it('should return Chinese instruction for zh', () => {
			const result = buildLanguageInstruction('zh');
			expect(result).toContain('Chinese');
			expect(result).toContain('中文');
		});

		it('should return empty string for unknown language code', () => {
			expect(buildLanguageInstruction('xx')).toBe('');
		});
	});

	describe('formatTimestamp', () => {
		it('should format 0 seconds as [00:00:00]', () => {
			expect(formatTimestamp(0)).toBe('[00:00:00]');
		});

		it('should format seconds only', () => {
			expect(formatTimestamp(45)).toBe('[00:00:45]');
		});

		it('should format minutes and seconds', () => {
			expect(formatTimestamp(125)).toBe('[00:02:05]');
		});

		it('should format hours, minutes, and seconds', () => {
			expect(formatTimestamp(3661)).toBe('[01:01:01]');
		});

		it('should handle fractional seconds by flooring', () => {
			expect(formatTimestamp(15.7)).toBe('[00:00:15]');
		});
	});

	describe('formatTranscriptSection', () => {
		it('should format diarized transcript with speaker names and timestamps', () => {
			const result: TranscriptionResult = {
				version: 1,
				audioFile: 'test.webm',
				provider: 'openai',
				model: 'gpt-4o-transcribe',
				language: 'en',
				segments: [
					{ speaker: 'Alice', start: 15, end: 30, text: 'Good morning everyone.' },
					{ speaker: 'Bob', start: 22, end: 40, text: 'Sure, I finished the API integration.' },
				],
				fullText: 'Good morning everyone. Sure, I finished the API integration.',
				createdAt: '2026-03-18T10:00:00Z',
			};

			const output = formatTranscriptSection(result);

			expect(output).toContain('[00:00:15] **[[Alice]]:** Good morning everyone.');
			expect(output).toContain('[00:00:22] **[[Bob]]:** Sure, I finished the API integration.');
		});

		it('should format non-diarized transcript using fullText', () => {
			const result: TranscriptionResult = {
				version: 1,
				audioFile: 'test.webm',
				provider: 'openai',
				model: 'gpt-4o-mini-transcribe',
				language: 'en',
				segments: [
					{ start: 0, end: 30, text: 'Good morning everyone.' },
					{ start: 30, end: 60, text: 'More content.' },
				],
				fullText: 'Good morning everyone. More content.',
				createdAt: '2026-03-18T10:00:00Z',
			};

			const output = formatTranscriptSection(result);

			expect(output).toBe('Good morning everyone. More content.');
		});

		it('should detect diarization when any segment has a speaker', () => {
			const result: TranscriptionResult = {
				version: 1,
				audioFile: 'test.webm',
				provider: 'openai',
				model: 'gpt-4o-transcribe',
				language: 'en',
				segments: [
					{ start: 0, end: 10, text: 'No speaker here.' },
					{ speaker: 'Alice', start: 10, end: 20, text: 'I have a speaker.' },
				],
				fullText: 'No speaker here. I have a speaker.',
				createdAt: '2026-03-18T10:00:00Z',
			};

			const output = formatTranscriptSection(result);

			expect(output).toContain('**[[Alice]]:**');
		});

		it('should order segments by start time', () => {
			const result: TranscriptionResult = {
				version: 1,
				audioFile: 'test.webm',
				provider: 'openai',
				model: 'gpt-4o-transcribe',
				language: 'en',
				segments: [
					{ speaker: 'Bob', start: 60, end: 90, text: 'Second.' },
					{ speaker: 'Alice', start: 15, end: 30, text: 'First.' },
				],
				fullText: 'First. Second.',
				createdAt: '2026-03-18T10:00:00Z',
			};

			const output = formatTranscriptSection(result);
			const aliceIndex = output.indexOf('**[[Alice]]:**');
			const bobIndex = output.indexOf('**[[Bob]]:**');

			expect(aliceIndex).toBeLessThan(bobIndex);
		});

		it('should not treat empty speaker strings as diarized', () => {
			const result: TranscriptionResult = {
				version: 1,
				audioFile: 'test.webm',
				provider: 'openai',
				model: 'gpt-4o-mini-transcribe',
				language: 'en',
				segments: [
					{ speaker: '', start: 0, end: 30, text: 'Some text.' },
					{ speaker: '  ', start: 30, end: 60, text: 'More text.' },
				],
				fullText: 'Some text. More text.',
				createdAt: '2026-03-18T10:00:00Z',
			};

			const output = formatTranscriptSection(result);

			expect(output).toBe('Some text. More text.');
		});
	});
});
