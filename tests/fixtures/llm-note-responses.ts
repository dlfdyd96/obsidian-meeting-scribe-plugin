import type { LLMNoteOutput } from '../../src/note/templates';

export function createLLMNoteOutput(
	overrides?: Partial<LLMNoteOutput>,
): LLMNoteOutput {
	return {
		metadata: {
			title: 'Weekly Standup',
			date: '2026-03-16',
			participants: ['Alice', 'Bob'],
			topics: ['sprint progress', 'blockers'],
			tags: ['meeting', 'standup'],
		},
		summary: 'The team discussed sprint progress and identified no major blockers.',
		key_discussion_points: [
			{ topic: 'Sprint Progress', summary: 'All tasks on track for the sprint deadline.' },
			{ topic: 'Blockers', summary: 'No blockers reported by any team member.' },
		],
		decisions: ['Continue with current sprint plan without changes'],
		action_items: [
			{ assignee: 'Alice', task: 'Update the sprint board', deadline: 'EOD Friday' },
			{ assignee: 'Bob', task: 'Review PR #42', deadline: null },
		],
		discussion_notes:
			'Alice opened the meeting by reviewing the sprint board. All tasks are progressing as expected.',
		...overrides,
	};
}

export function createLLMNoteOutputJSON(overrides?: Partial<LLMNoteOutput>): string {
	return JSON.stringify(createLLMNoteOutput(overrides));
}

export function createLLMNoteOutputWithCodeFences(overrides?: Partial<LLMNoteOutput>): string {
	return '```json\n' + createLLMNoteOutputJSON(overrides) + '\n```';
}
