import type { TranscriptionResult } from '../providers/types';

export interface LLMNoteOutput {
	metadata: {
		title: string;
		date: string | null;
		participants: string[];
		topics: string[];
		tags: string[];
	};
	summary: string;
	key_discussion_points: Array<{
		topic: string;
		summary: string;
	}>;
	decisions: string[];
	action_items: Array<{
		assignee: string;
		task: string;
		deadline: string | null;
	}>;
	discussion_notes: string;
}

export interface SummaryPreset {
	id: string;
	name: string;
	description: string;
	systemPrompt: string;
	userPromptTemplate: string;
}

const SYSTEM_PROMPT = `You are a meeting note assistant. Your task is to analyze a meeting transcript and produce structured meeting notes.

You will receive a transcript of a meeting. Analyze it and produce output in the following JSON format:

{
  "metadata": {
    "title": "concise meeting title",
    "date": "YYYY-MM-DD if mentioned, otherwise null",
    "participants": ["list", "of", "speaker", "names"],
    "topics": ["main", "subjects", "discussed"],
    "tags": ["relevant", "keywords"]
  },
  "summary": "2-4 sentence overview of the meeting",
  "key_discussion_points": [
    {"topic": "Topic Name", "summary": "Brief summary of discussion"}
  ],
  "decisions": [
    "Decision 1 with rationale",
    "Decision 2 with rationale"
  ],
  "action_items": [
    {"assignee": "Person", "task": "What they need to do", "deadline": "if mentioned, otherwise null"}
  ],
  "discussion_notes": "Detailed chronological notes capturing the flow of the meeting"
}

Rules:
1. Use speaker labels exactly as they appear in the transcript (e.g., "Participant 1"). Reference them as plain text in the summary, discussion notes, and action items. Do NOT use [[wiki-link]] format.
2. Generate tags that would be useful for searching and organizing notes. Always include "meeting" as a tag. Use lowercase, hyphenated format (e.g., "sprint-planning").
3. Action items should include the assignee name and specific task. Use checkbox format compatible with Obsidian Tasks plugin.
4. If the transcript language is not English, write the notes in the same language as the transcript.
5. If the transcript is very short or unclear, do your best with available information. Use empty arrays for fields that cannot be determined.
6. Output ONLY the JSON object. No markdown code fences, no explanation.
7. For the "Key Discussion Points" and "Decisions" sections, be specific and actionable.
8. For "Action Items", always include the assignee. If no deadline is mentioned, set deadline to null.`;

const USER_PROMPT_TEMPLATE = `Here is the meeting transcript to analyze:

---TRANSCRIPT START---
{{transcript}}
---TRANSCRIPT END---

Generate structured meeting notes from this transcript.`;

const DEFAULT_PRESET: SummaryPreset = {
	id: 'default',
	name: 'Meeting Notes',
	description: 'General-purpose meeting summary with metadata extraction',
	systemPrompt: SYSTEM_PROMPT,
	userPromptTemplate: USER_PROMPT_TEMPLATE,
};

export function getDefaultPreset(): SummaryPreset {
	return { ...DEFAULT_PRESET };
}

export function buildUserPrompt(template: string, transcript: string): string {
	return template.split('{{transcript}}').join(transcript);
}

const LANGUAGE_NAMES: Record<string, string> = {
	'ko': 'Korean (한국어)',
	'en': 'English',
	'ja': 'Japanese (日本語)',
	'zh': 'Chinese (中文)',
};

export function buildLanguageInstruction(summaryLanguage: string): string {
	if (summaryLanguage === 'auto') return '';
	const name = LANGUAGE_NAMES[summaryLanguage];
	if (!name) return '';
	return `\nIMPORTANT: You MUST write ALL notes in ${name}, regardless of the transcript language.`;
}

export function formatTimestamp(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

export function formatTranscriptSection(transcriptionResult: TranscriptionResult): string {
	const hasDiarization = transcriptionResult.segments.some(
		s => s.speaker && s.speaker.trim() !== ''
	);

	if (!hasDiarization) {
		return transcriptionResult.fullText;
	}

	const sorted = [...transcriptionResult.segments].sort((a, b) => a.start - b.start);
	const lines = sorted.map(segment => {
		const timestamp = formatTimestamp(segment.start);
		const speaker = segment.speaker && segment.speaker.trim() !== '' ? segment.speaker : 'Unknown';
		return `${timestamp} **${speaker}:** ${segment.text}`;
	});

	return lines.join('\n');
}

export function formatSummaryBody(output: LLMNoteOutput): string {
	const sections: string[] = [];

	// Summary section
	sections.push('## Summary');
	sections.push('');
	sections.push(output.summary);

	// Key Discussion Points
	sections.push('');
	sections.push('## Key Discussion Points');
	sections.push('');
	if (output.key_discussion_points.length > 0) {
		for (const point of output.key_discussion_points) {
			sections.push(`- **${point.topic}:** ${point.summary}`);
		}
	}

	// Decisions
	sections.push('');
	sections.push('## Decisions');
	sections.push('');
	if (output.decisions.length > 0) {
		for (const decision of output.decisions) {
			sections.push(`- ${decision}`);
		}
	}

	// Action Items
	sections.push('');
	sections.push('## Action Items');
	sections.push('');
	if (output.action_items.length > 0) {
		for (const item of output.action_items) {
			const deadline = item.deadline ? ` (by ${item.deadline})` : '';
			sections.push(`- [ ] @${item.assignee}: ${item.task}${deadline}`);
		}
	}

	// Discussion Notes
	sections.push('');
	sections.push('## Discussion Notes');
	sections.push('');
	if (output.discussion_notes) {
		sections.push(output.discussion_notes);
	}

	return sections.join('\n');
}
