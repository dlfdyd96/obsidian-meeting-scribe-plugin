import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateNote, generateFilename, generateTranscriptNote, generateTranscriptFilename, extractParticipants, applyParticipantReplacements, parseFrontmatter, parseParticipantsFromYaml } from '../../src/note/note-generator';
import type { SummaryResult, TranscriptionResult, MeetingMetadata, ParticipantAlias } from '../../src/providers/types';

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

	it('appends transcript section when includeTranscript is true', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			includeTranscript: true,
		});

		expect(result).toContain('## Transcript');
		expect(result).toContain('Meeting content.');
	});

	it('does not include transcript section when includeTranscript is false', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			includeTranscript: false,
		});

		expect(result).not.toContain('## Transcript');
	});

	it('does not include transcript when includeTranscript is not specified (backwards compatible)', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
		});

		// Default behavior: no transcript (backwards compatible)
		expect(result).not.toContain('## Transcript');
	});

	it('formats diarized transcript with speaker names and timestamps', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: 'Alice', start: 15, end: 30, text: 'Good morning.' },
				{ speaker: 'Bob', start: 22, end: 40, text: 'Hello!' },
			],
			fullText: 'Good morning. Hello!',
		});

		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: transcription,
			audioFilePath: 'test/audio.webm',
			includeTranscript: true,
		});

		expect(result).toContain('[00:00:15] **Alice:** Good morning.');
		expect(result).toContain('[00:00:22] **Bob:** Hello!');
	});

	it('formats non-diarized transcript as continuous text', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			includeTranscript: true,
		});

		expect(result).toContain('## Transcript');
		expect(result).toContain('Meeting content. More content.');
	});

	it('has correct note structure: frontmatter → summary → transcript', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			includeTranscript: true,
		});

		const summaryIndex = result.indexOf('## Summary');
		const transcriptIndex = result.indexOf('## Transcript');

		expect(result.startsWith('---\n')).toBe(true);
		expect(summaryIndex).toBeGreaterThan(0);
		expect(transcriptIndex).toBeGreaterThan(summaryIndex);
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

describe('generateNote with transcriptLink (two-file mode)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('includes wiki-link to transcript instead of inline transcript', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			transcriptLink: '[[2026-03-16 Weekly Standup - Transcript]]',
		});

		expect(result).toContain('> Full transcript: [[2026-03-16 Weekly Standup - Transcript]]');
		expect(result).not.toContain('## Transcript');
	});

	it('adds transcript field to frontmatter', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			transcriptLink: '[[2026-03-16 Weekly Standup - Transcript]]',
		});

		expect(result).toContain('transcript:');
	});

	it('still includes audio embed', () => {
		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			transcriptLink: '[[2026-03-16 Weekly Standup - Transcript]]',
		});

		expect(result).toContain('![[audio.webm]]');
	});
});

describe('generateTranscriptNote', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('generates a transcript note with frontmatter and transcript section', () => {
		const result = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			meetingNoteLink: '[[2026-03-16 Weekly Standup]]',
		});

		expect(result).toContain('type: transcript');
		expect(result).toContain('meeting:');
		expect(result).toContain('## Transcript');
		expect(result).toContain('Meeting content. More content.');
	});

	it('includes meeting back-link in frontmatter', () => {
		const result = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			meetingNoteLink: '[[2026-03-16 Weekly Standup]]',
		});

		expect(result).toContain("meeting: '[[2026-03-16 Weekly Standup]]'");
	});

	it('does not include title field as type:meeting frontmatter', () => {
		const result = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			meetingNoteLink: '[[2026-03-16 Weekly Standup]]',
		});

		// Type should be transcript, not meeting
		expect(result).toContain('type: transcript');
		expect(result).not.toMatch(/^type: meeting$/m);
	});

	it('formats diarized transcript with speaker labels', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 45, text: 'Hello everyone.' },
				{ speaker: 'Participant 2', start: 45, end: 90, text: 'Good morning.' },
			],
			fullText: 'Hello everyone. Good morning.',
		});

		const result = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: transcription,
			audioFilePath: 'test/audio.webm',
			meetingNoteLink: '[[2026-03-16 Weekly Standup]]',
		});

		expect(result).toContain('**Participant 1:**');
		expect(result).toContain('**Participant 2:**');
	});
});

describe('extractParticipants', () => {
	it('extracts unique speakers in order of first appearance', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 10, text: 'Hello.' },
				{ speaker: 'Participant 2', start: 10, end: 20, text: 'Hi.' },
				{ speaker: 'Participant 1', start: 20, end: 30, text: 'How are you?' },
			],
		});

		const result = extractParticipants(transcription);

		expect(result).toEqual([
			{ alias: 'Participant 1', name: '' },
			{ alias: 'Participant 2', name: '' },
		]);
	});

	it('returns empty array when no segments have speakers', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ start: 0, end: 10, text: 'No speaker.' },
				{ start: 10, end: 20, text: 'Still no speaker.' },
			],
		});

		const result = extractParticipants(transcription);

		expect(result).toEqual([]);
	});

	it('ignores empty/whitespace speaker strings', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: '', start: 0, end: 10, text: 'Empty.' },
				{ speaker: '  ', start: 10, end: 20, text: 'Whitespace.' },
				{ speaker: 'Participant 1', start: 20, end: 30, text: 'Real speaker.' },
			],
		});

		const result = extractParticipants(transcription);

		expect(result).toEqual([
			{ alias: 'Participant 1', name: '' },
		]);
	});

	it('returns empty array for zero segments', () => {
		const transcription = createMockTranscriptionResult({ segments: [] });

		const result = extractParticipants(transcription);

		expect(result).toEqual([]);
	});
});

describe('generateNote with participants', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes participants through to frontmatter', () => {
		const participants = [
			{ alias: 'Participant 1', name: '' },
			{ alias: 'Participant 2', name: '' },
		];

		const result = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			participants,
		});

		expect(result).toContain('  - alias: "Participant 1"');
		expect(result).toContain('  - alias: "Participant 2"');
	});
});

describe('generateTranscriptNote with participants', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes participants through to transcript frontmatter', () => {
		const participants = [
			{ alias: 'Participant 1', name: '' },
		];

		const result = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: createMockTranscriptionResult(),
			audioFilePath: 'test/audio.webm',
			meetingNoteLink: '[[2026-03-16 Weekly Standup]]',
			participants,
		});

		expect(result).toContain('  - alias: "Participant 1"');
		expect(result).toContain('type: transcript');
	});
});

describe('parseFrontmatter', () => {
	it('parses frontmatter and body from markdown', () => {
		const content = '---\ndate: 2026-03-20\ntitle: Test\n---\nBody content here.';
		const result = parseFrontmatter(content);

		expect(result).not.toBeNull();
		expect(result!.frontmatter).toContain('date: 2026-03-20');
		expect(result!.body).toContain('Body content here.');
	});

	it('returns null for content without frontmatter', () => {
		const result = parseFrontmatter('No frontmatter here.');
		expect(result).toBeNull();
	});
});

describe('parseParticipantsFromYaml', () => {
	it('parses participant aliases from YAML frontmatter', () => {
		const yaml = 'date: 2026-03-20\nparticipants:\n  - alias: "Participant 1"\n    name: ""\n  - alias: "Participant 2"\n    name: "Paul"\ntags:\n  - meeting';
		const result = parseParticipantsFromYaml(yaml);

		expect(result).toEqual([
			{ alias: 'Participant 1', name: '' },
			{ alias: 'Participant 2', name: 'Paul' },
		]);
	});

	it('returns null when no participants section exists', () => {
		const yaml = 'date: 2026-03-20\ntags:\n  - meeting';
		const result = parseParticipantsFromYaml(yaml);
		expect(result).toBeNull();
	});
});

describe('applyParticipantReplacements', () => {
	const makeContent = (participants: ParticipantAlias[], body: string) => {
		const pLines = participants.map(p =>
			`  - alias: "${p.alias}"\n    name: "${p.name}"`
		).join('\n');
		return `---\ndate: 2026-03-20\nparticipants:\n${pLines}\ncreated_by: meeting-scribe\n---\n${body}`;
	};

	it('replaces plain text **Participant N:** with **[[name]]:** for new format notes', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Paul' },
			{ alias: 'Participant 2', name: '' },
		];
		const body = 'Said by **Participant 1:** hello. **Participant 2:** hi.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**[[Paul]]:**');
		expect(result.updatedContent).toContain('**Participant 2:**');
		expect(result.replacementCount).toBe(1);
	});

	it('replaces old wiki-link format [[Participant N]] for backward compat', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Paul' },
			{ alias: 'Participant 2', name: '' },
		];
		const body = 'Said by **[[Participant 1]]:** hello. **[[Participant 2]]:** hi.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**[[Paul]]:**');
		expect(result.updatedContent).toContain('**[[Participant 2]]:**');
		expect(result.replacementCount).toBe(1);
	});

	it('replaces with wiki-link name as-is when name starts with [[', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: '[[People/Paul]]' },
		];
		const body = 'Quote from **Participant 1:** something.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**[[People/Paul]]:**');
		expect(result.updatedParticipants[0]!.alias).toBe('People/Paul');
	});

	it('handles idempotent replacement (re-run with different name)', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Paul', name: 'Kim' },
		];
		const body = 'Said by **[[Paul]]:** hello.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**[[Kim]]:**');
		expect(result.updatedParticipants[0]!.alias).toBe('Kim');
		expect(result.replacementCount).toBe(1);
	});

	it('skips participants with empty names', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: '' },
		];
		const body = '**Participant 1:** hello.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**Participant 1:**');
		expect(result.replacementCount).toBe(0);
	});

	it('returns original content when no frontmatter exists', () => {
		const content = 'No frontmatter here.';
		const result = applyParticipantReplacements(content, []);

		expect(result.updatedContent).toBe(content);
		expect(result.replacementCount).toBe(0);
	});

	it('handles multiple occurrences of the same participant (new format)', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Alice' },
		];
		const body = '**Participant 1:** hello. Later, **Participant 1:** goodbye.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.replacementCount).toBe(2);
		expect(result.updatedContent).not.toContain('**Participant 1:**');
		expect(result.updatedContent).toContain('**[[Alice]]:**');
	});

	it('handles multiple occurrences of the same participant (old wiki-link format)', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Alice' },
		];
		const body = '**[[Participant 1]]:** hello. Later, **[[Participant 1]]:** goodbye.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.replacementCount).toBe(2);
		expect(result.updatedContent).not.toContain('[[Participant 1]]');
		expect(result.updatedContent).toContain('**[[Alice]]:**');
	});

	it('does not corrupt longer aliases that share a prefix (e.g., Participant 1 vs Participant 10)', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Alice' },
			{ alias: 'Participant 10', name: 'Bob' },
		];
		const body = '**Participant 1:** hello. **Participant 10:** goodbye. Participant 10 took notes. Participant 1 led.';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('**[[Alice]]:**');
		expect(result.updatedContent).toContain('**[[Bob]]:**');
		expect(result.updatedContent).toContain('[[Bob]] took notes');
		expect(result.updatedContent).toContain('[[Alice]] led');
		expect(result.updatedContent).not.toContain('[[Alice]]0');
	});

	it('updates frontmatter participants with new alias values', () => {
		const participants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Paul' },
			{ alias: 'Participant 2', name: '[[People/Kim]]' },
		];
		const body = '**Participant 1:** a **Participant 2:** b';
		const content = makeContent(participants, body);

		const result = applyParticipantReplacements(content, participants);

		expect(result.updatedContent).toContain('alias: "Paul"');
		expect(result.updatedContent).toContain('alias: "People/Kim"');
	});
});

describe('generateTranscriptFilename', () => {
	it('appends - Transcript before .md extension', () => {
		expect(generateTranscriptFilename('2026-03-16 Weekly Standup.md'))
			.toBe('2026-03-16 Weekly Standup - Transcript.md');
	});

	it('handles Korean titles', () => {
		expect(generateTranscriptFilename('2026-03-16 팀 주간회의.md'))
			.toBe('2026-03-16 팀 주간회의 - Transcript.md');
	});
});

describe('Integration: full pipeline flow → replacement', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('generates note with plain text participants, then replacement adds wiki-links', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 30, text: 'Hello everyone.' },
				{ speaker: 'Participant 2', start: 30, end: 60, text: 'Good morning.' },
			],
			fullText: 'Hello everyone. Good morning.',
		});
		const participants = extractParticipants(transcription);

		// Generate meeting note (LLM summary uses plain text references)
		const note = generateNote({
			summaryResult: createMockSummaryResult({ summary: '## Summary\n\nParticipant 1 led the meeting. Participant 2 took notes.' }),
			transcriptionResult: transcription,
			audioFilePath: 'audio/test.webm',
			transcriptLink: '[[2026-03-20 Test - Transcript]]',
			participants,
		});

		// Generate transcript note
		const transcript = generateTranscriptNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: transcription,
			audioFilePath: 'audio/test.webm',
			meetingNoteLink: '[[2026-03-20 Test]]',
			participants,
		});

		// Verify initial state: plain text, no wiki-links
		expect(note).toContain('alias: "Participant 1"');
		expect(note).toContain('alias: "Participant 2"');
		expect(transcript).toContain('**Participant 1:**');
		expect(transcript).toContain('**Participant 2:**');
		expect(transcript).not.toContain('**[[Participant 1]]:**');

		// Simulate user editing names
		const editedParticipants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Paul' },
			{ alias: 'Participant 2', name: '[[People/김과장]]' },
		];

		// Apply replacements to transcript (plain text → wiki-link)
		const transcriptResult = applyParticipantReplacements(transcript, editedParticipants);
		expect(transcriptResult.updatedContent).toContain('**[[Paul]]:**');
		expect(transcriptResult.updatedContent).toContain('**[[People/김과장]]:**');
		expect(transcriptResult.updatedContent).not.toContain('**Participant 1:**');
	});

	it('backward compat: replacement works on old wiki-link format notes', () => {
		// Simulate a note generated by an older version (wiki-link format)
		const oldFormatBody = '---\ndate: 2026-03-20\nparticipants:\n  - alias: "Participant 1"\n    name: ""\ncreated_by: meeting-scribe\n---\n**[[Participant 1]]:** hello.';

		const editedParticipants: ParticipantAlias[] = [
			{ alias: 'Participant 1', name: 'Paul' },
		];

		const result = applyParticipantReplacements(oldFormatBody, editedParticipants);
		expect(result.updatedContent).toContain('**[[Paul]]:**');
		expect(result.updatedContent).not.toContain('[[Participant 1]]');
		expect(result.replacementCount).toBe(1);
	});

	it('idempotent: re-run with different names works correctly', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 30, text: 'Hello.' },
			],
			fullText: 'Hello.',
		});
		const participants = extractParticipants(transcription);

		const note = generateNote({
			summaryResult: createMockSummaryResult({ summary: '## Summary\n\nParticipant 1 spoke.' }),
			transcriptionResult: transcription,
			audioFilePath: 'audio/test.webm',
			participants,
		});

		// First replacement: Participant 1 → Paul
		const first = applyParticipantReplacements(note, [
			{ alias: 'Participant 1', name: 'Paul' },
		]);
		expect(first.updatedContent).toContain('[[Paul]]');
		expect(first.updatedParticipants[0]!.alias).toBe('Paul');

		// Second replacement: Paul → Kim (using updated participants from first run)
		const secondParticipants = first.updatedParticipants.map(p => ({ ...p, name: 'Kim' }));
		const second = applyParticipantReplacements(first.updatedContent, secondParticipants);
		expect(second.updatedContent).toContain('[[Kim]]');
		expect(second.updatedContent).not.toContain('[[Paul]]');
	});

	it('no-speaker scenario: empty participants, no wiki-links in transcript', () => {
		const transcription = createMockTranscriptionResult({
			segments: [
				{ start: 0, end: 30, text: 'Hello everyone.' },
			],
			fullText: 'Hello everyone.',
		});
		const participants = extractParticipants(transcription);

		expect(participants).toEqual([]);

		const note = generateNote({
			summaryResult: createMockSummaryResult(),
			transcriptionResult: transcription,
			audioFilePath: 'audio/test.webm',
			includeTranscript: true,
			participants,
		});

		expect(note).toContain('participants: []');
		expect(note).not.toContain('[[Participant');
	});
});
