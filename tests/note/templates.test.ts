import { describe, it, expect } from 'vitest';
import {
	getDefaultPreset,
	buildUserPrompt,
	formatSummaryBody,
	type SummaryPreset,
	type LLMNoteOutput,
} from '../../src/note/templates';

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
});
