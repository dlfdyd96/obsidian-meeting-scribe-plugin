import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenerateNoteStep } from '../../../src/pipeline/steps/generate-note-step';
import { DataError } from '../../../src/utils/errors';
import type { PipelineContext } from '../../../src/pipeline/pipeline-types';
import type { SummaryResult, TranscriptionResult } from '../../../src/providers/types';
import type { MeetingScribeSettings } from '../../../src/settings/settings';

function createMockVault() {
	return {
		create: vi.fn().mockResolvedValue({ path: '' }),
		getAbstractFileByPath: vi.fn().mockReturnValue(null),
		createFolder: vi.fn().mockResolvedValue({}),
	};
}

function createMockSummaryResult(overrides?: Partial<SummaryResult>): SummaryResult {
	return {
		version: 1,
		provider: 'openai',
		model: 'gpt-4o-mini',
		summary: '## Summary\n\nTest meeting summary.',
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

function createMockContext(overrides?: Partial<PipelineContext>): PipelineContext {
	return {
		audioFilePath: '_attachments/audio/2026-03-16-recording.webm',
		vault: createMockVault() as unknown as PipelineContext['vault'],
		settings: {
			settingsVersion: 7,
			sttProvider: 'openai',
			sttApiKey: 'test-stt-key',
			sttModel: 'gpt-4o-mini-transcribe',
			sttLanguage: 'auto',
			llmProvider: 'openai',
			llmApiKey: 'test-llm-key',
			llmModel: 'gpt-4o-mini',
			outputFolder: 'Meeting Notes',
			audioFolder: '_attachments/audio',
			audioRetentionPolicy: 'keep' as const,
			summaryLanguage: 'auto',
			includeTranscript: true,
			enableSmartChunking: false,
			debugMode: false,
			onboardingComplete: false,
			clovaInvokeUrl: '',
			clovaSecretKey: '',
			geminiApiKey: '',
			showConsentReminder: true,
			separateTranscriptFile: false,
		} satisfies MeetingScribeSettings,
		transcriptionResult: createMockTranscriptionResult(),
		summaryResult: createMockSummaryResult(),
		...overrides,
	};
}

describe('GenerateNoteStep', () => {
	let step: GenerateNoteStep;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
		step = new GenerateNoteStep();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('has name "generate-note"', () => {
		expect(step.name).toBe('generate-note');
	});

	it('creates note file in output folder', async () => {
		const context = createMockContext();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

		const result = await step.execute(context);

		expect(vault.create).toHaveBeenCalledOnce();
		const [path, content] = vault.create.mock.calls[0]!;
		expect(path).toBe('Meeting Notes/2026-03-16 Weekly Standup.md');
		expect(content).toContain('---');
		expect(content).toContain('## Summary');
	});

	it('creates output folder if it does not exist', async () => {
		const context = createMockContext();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;
		vault.getAbstractFileByPath.mockReturnValue(null);

		await step.execute(context);

		expect(vault.createFolder).toHaveBeenCalledWith('Meeting Notes');
	});

	it('does not create folder if it already exists', async () => {
		const context = createMockContext();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;
		// First call checks folder (exists), second call checks file (not exists)
		vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Meeting Notes') return { path: 'Meeting Notes' };
			return null;
		});

		await step.execute(context);

		expect(vault.createFolder).not.toHaveBeenCalled();
	});

	it('handles duplicate filenames with numeric suffix', async () => {
		const context = createMockContext();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

		// First file check: folder exists. Second: file exists. Third: file with suffix doesn't exist.
		vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Meeting Notes') return { path: 'Meeting Notes' };
			if (path === 'Meeting Notes/2026-03-16 Weekly Standup.md') return { path };
			return null;
		});

		const result = await step.execute(context);

		const [path] = vault.create.mock.calls[0]!;
		expect(path).toBe('Meeting Notes/2026-03-16 Weekly Standup 2.md');
	});

	it('handles multiple duplicate filenames', async () => {
		const context = createMockContext();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

		vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'Meeting Notes') return { path: 'Meeting Notes' };
			if (path === 'Meeting Notes/2026-03-16 Weekly Standup.md') return { path };
			if (path === 'Meeting Notes/2026-03-16 Weekly Standup 2.md') return { path };
			return null;
		});

		await step.execute(context);

		const [path] = vault.create.mock.calls[0]!;
		expect(path).toBe('Meeting Notes/2026-03-16 Weekly Standup 3.md');
	});

	it('generates template note when summaryResult is missing', async () => {
		const context = createMockContext({ summaryResult: undefined });

		const result = await step.execute(context);

		expect(result.noteFilePath).toBeDefined();
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;
		const [, content] = vault.create.mock.calls[0]!;
		expect(content).toContain('## Overview');
		expect(content).toContain('## Action Items');
		expect(content).toContain('## Notes');
	});

	it('sets noteFilePath in returned context', async () => {
		const context = createMockContext();

		const result = await step.execute(context);

		expect(result.noteFilePath).toBe('Meeting Notes/2026-03-16 Weekly Standup.md');
	});

	it('reports progress via onProgress', async () => {
		const onProgress = vi.fn();
		const context = createMockContext({ onProgress });

		await step.execute(context);

		expect(onProgress).toHaveBeenCalledWith('generating-note', 1, 1);
	});

	it('preserves existing context fields', async () => {
		const context = createMockContext();

		const result = await step.execute(context);

		expect(result.audioFilePath).toBe(context.audioFilePath);
		expect(result.transcriptionResult).toBe(context.transcriptionResult);
		expect(result.summaryResult).toBe(context.summaryResult);
		expect(result.settings).toBe(context.settings);
	});

	it('does not include participants in generated note frontmatter', async () => {
		const context = createMockContext({
			transcriptionResult: createMockTranscriptionResult({
				segments: [
					{ speaker: 'Participant 1', start: 0, end: 30, text: 'Hello.' },
					{ speaker: 'Participant 2', start: 30, end: 60, text: 'Hi.' },
					{ speaker: 'Participant 1', start: 60, end: 90, text: 'More talk.' },
				],
			}),
		});
		const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

		await step.execute(context);

		const noteContent = vault.create.mock.calls[0]![1] as string;
		expect(noteContent).not.toContain('participants:');
	});

	describe('two-file output (separateTranscriptFile)', () => {
		it('creates both meeting note and transcript file', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: true };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			const result = await step.execute(context);

			expect(vault.create).toHaveBeenCalledTimes(2);
			const notePath = vault.create.mock.calls[0]![0];
			const transcriptPath = vault.create.mock.calls[1]![0];
			expect(notePath).toBe('Meeting Notes/2026-03-16 Weekly Standup.md');
			expect(transcriptPath).toBe('Meeting Notes/2026-03-16 Weekly Standup - Transcript.md');
		});

		it('sets both noteFilePath and transcriptFilePath in context', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: true };

			const result = await step.execute(context);

			expect(result.noteFilePath).toBe('Meeting Notes/2026-03-16 Weekly Standup.md');
			expect(result.transcriptFilePath).toBe('Meeting Notes/2026-03-16 Weekly Standup - Transcript.md');
		});

		it('meeting note contains wiki-link to transcript', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: true };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			await step.execute(context);

			const noteContent = vault.create.mock.calls[0]![1] as string;
			expect(noteContent).toContain('[[2026-03-16 Weekly Standup - Transcript]]');
			expect(noteContent).not.toContain('## Transcript');
		});

		it('transcript file contains back-link to meeting note', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: true };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			await step.execute(context);

			const transcriptContent = vault.create.mock.calls[1]![1] as string;
			expect(transcriptContent).toContain('[[2026-03-16 Weekly Standup]]');
			expect(transcriptContent).toContain('## Transcript');
		});

		it('handles duplicate filenames for both files', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: true };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'Meeting Notes') return { path: 'Meeting Notes' };
				if (path === 'Meeting Notes/2026-03-16 Weekly Standup.md') return { path };
				if (path === 'Meeting Notes/2026-03-16 Weekly Standup - Transcript.md') return { path };
				return null;
			});

			await step.execute(context);

			const notePath = vault.create.mock.calls[0]![0];
			const transcriptPath = vault.create.mock.calls[1]![0];
			expect(notePath).toBe('Meeting Notes/2026-03-16 Weekly Standup 2.md');
			expect(transcriptPath).toBe('Meeting Notes/2026-03-16 Weekly Standup - Transcript 2.md');

			// Wiki-links must reference the deduplicated filenames
			const noteContent = vault.create.mock.calls[0]![1] as string;
			const transcriptContent = vault.create.mock.calls[1]![1] as string;
			expect(noteContent).toContain('[[2026-03-16 Weekly Standup - Transcript 2]]');
			expect(transcriptContent).toContain('[[2026-03-16 Weekly Standup 2]]');
		});

		it('uses single-file mode when separateTranscriptFile is false', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: false, includeTranscript: true };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			const result = await step.execute(context);

			expect(vault.create).toHaveBeenCalledTimes(1);
			expect(result.transcriptFilePath).toBeUndefined();
			const noteContent = vault.create.mock.calls[0]![1] as string;
			expect(noteContent).toContain('## Transcript');
		});

		it('only creates meeting note when includeTranscript is false even if separateTranscriptFile is true', async () => {
			const context = createMockContext();
			context.settings = { ...context.settings, separateTranscriptFile: true, includeTranscript: false };
			const vault = context.vault as unknown as ReturnType<typeof createMockVault>;

			const result = await step.execute(context);

			expect(vault.create).toHaveBeenCalledTimes(1);
			expect(result.transcriptFilePath).toBeUndefined();
			const noteContent = vault.create.mock.calls[0]![1] as string;
			expect(noteContent).not.toContain('## Transcript');
		});
	});
});
