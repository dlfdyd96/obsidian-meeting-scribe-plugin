import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeStep } from '../../../src/pipeline/steps/summarize-step';
import { providerRegistry } from '../../../src/providers/provider-registry';
import { ConfigError, DataError } from '../../../src/utils/errors';
import type { PipelineContext } from '../../../src/pipeline/pipeline-types';
import type { LLMProvider, SummaryResult, TranscriptionResult } from '../../../src/providers/types';
import type { MeetingScribeSettings } from '../../../src/settings/settings';
import { createLLMNoteOutputJSON, createLLMNoteOutputWithCodeFences } from '../../fixtures/llm-note-responses';

function createMockProvider(overrides?: Partial<LLMProvider>): LLMProvider {
	return {
		name: 'mock-llm',
		summarize: vi.fn<[string, string], Promise<SummaryResult>>().mockResolvedValue({
			version: 1,
			provider: 'mock-llm',
			model: 'mock-model',
			summary: createLLMNoteOutputJSON(),
			metadata: {
				title: 'Weekly Standup',
				date: '2026-03-16',
				participants: ['Alice', 'Bob'],
				topics: ['sprint progress', 'blockers'],
				tags: ['meeting', 'standup'],
			},
			createdAt: '2026-03-16T00:00:00Z',
		}),
		validateApiKey: vi.fn().mockResolvedValue(true),
		getSupportedModels: vi.fn().mockReturnValue([]),
		setCredentials: vi.fn(),
		...overrides,
	};
}

function createMockContext(overrides?: Partial<PipelineContext>): PipelineContext {
	return {
		audioFilePath: 'test/audio.webm',
		vault: {} as PipelineContext['vault'],
		settings: {
			settingsVersion: 3,
			sttProvider: 'openai',
			sttApiKey: 'test-stt-key',
			sttModel: 'gpt-4o-mini-transcribe',
			sttLanguage: 'auto',
			llmProvider: 'mock-llm',
			llmApiKey: 'test-llm-key',
			llmModel: 'mock-model',
			outputFolder: 'Meeting Notes',
			audioFolder: '_attachments/audio',
			audioRetentionPolicy: 'keep' as const,
			summaryLanguage: 'auto',
			includeTranscript: true,
			debugMode: false,
		} satisfies MeetingScribeSettings,
		transcriptionResult: {
			version: 1,
			audioFile: 'test/audio.webm',
			provider: 'openai',
			model: 'gpt-4o-mini-transcribe',
			language: 'en',
			segments: [{ start: 0, end: 10, text: 'Hello everyone.' }],
			fullText: 'Hello everyone. Let us discuss the sprint progress.',
			createdAt: '2026-03-16T00:00:00Z',
		} satisfies TranscriptionResult,
		...overrides,
	};
}

describe('SummarizeStep', () => {
	let step: SummarizeStep;
	let mockProvider: ReturnType<typeof createMockProvider>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		step = new SummarizeStep();
		mockProvider = createMockProvider();
	});

	it('should have name "summarize"', () => {
		expect(step.name).toBe('summarize');
	});

	describe('execute', () => {
		it('should call LLM provider with system and user prompts', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			await step.execute(context);

			expect(mockProvider.setCredentials).toHaveBeenCalledWith({ type: 'api-key', apiKey: 'test-llm-key' });
			expect(mockProvider.summarize).toHaveBeenCalledOnce();

			const [systemPrompt, userPrompt] = (mockProvider.summarize as ReturnType<typeof vi.fn>).mock.calls[0]!;
			expect(systemPrompt).toContain('meeting note assistant');
			expect(userPrompt).toContain('Hello everyone. Let us discuss the sprint progress.');
			expect(userPrompt).not.toContain('{{transcript}}');
		});

		it('should return context with summaryResult', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			const result = await step.execute(context);

			expect(result.summaryResult).toBeDefined();
			expect(result.summaryResult?.provider).toBe('mock-llm');
			expect(result.summaryResult?.metadata).toBeDefined();
			expect(result.summaryResult?.metadata?.title).toBe('Weekly Standup');
		});

		it('should format summary body from structured JSON when provider returns raw JSON', async () => {
			// When provider falls back to raw content (JSON string in summary)
			const rawJSON = createLLMNoteOutputJSON();
			mockProvider = createMockProvider({
				summarize: vi.fn().mockResolvedValue({
					version: 1,
					provider: 'mock-llm',
					model: 'mock-model',
					summary: rawJSON,
					metadata: undefined,
					createdAt: '2026-03-16T00:00:00Z',
				}),
			});
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			const result = await step.execute(context);

			expect(result.summaryResult).toBeDefined();
			// Should have parsed the JSON and built markdown body
			expect(result.summaryResult?.summary).toContain('## Summary');
			expect(result.summaryResult?.summary).toContain('## Key Discussion Points');
			expect(result.summaryResult?.summary).toContain('## Action Items');
			// Should have extracted metadata from JSON
			expect(result.summaryResult?.metadata?.title).toBe('Weekly Standup');
		});

		it('should handle JSON wrapped in code fences', async () => {
			const codeFencedJSON = createLLMNoteOutputWithCodeFences();
			mockProvider = createMockProvider({
				summarize: vi.fn().mockResolvedValue({
					version: 1,
					provider: 'mock-llm',
					model: 'mock-model',
					summary: codeFencedJSON,
					metadata: undefined,
					createdAt: '2026-03-16T00:00:00Z',
				}),
			});
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			const result = await step.execute(context);

			expect(result.summaryResult?.summary).toContain('## Summary');
			expect(result.summaryResult?.metadata?.title).toBe('Weekly Standup');
		});

		it('should fallback to raw summary text on unparseable response', async () => {
			mockProvider = createMockProvider({
				summarize: vi.fn().mockResolvedValue({
					version: 1,
					provider: 'mock-llm',
					model: 'mock-model',
					summary: 'This is just a plain text summary with no JSON structure.',
					metadata: { title: 'Fallback Title' },
					createdAt: '2026-03-16T00:00:00Z',
				}),
			});
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			const result = await step.execute(context);

			// Should keep raw summary since JSON parsing failed
			expect(result.summaryResult?.summary).toBe(
				'This is just a plain text summary with no JSON structure.',
			);
			// Should keep provider-returned metadata
			expect(result.summaryResult?.metadata?.title).toBe('Fallback Title');
		});

		it('should append language instruction to system prompt when summaryLanguage is set', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext({
				settings: {
					...createMockContext().settings,
					summaryLanguage: 'ko',
				},
			});
			await step.execute(context);

			const [systemPrompt] = (mockProvider.summarize as ReturnType<typeof vi.fn>).mock.calls[0]!;
			expect(systemPrompt).toContain('Korean');
			expect(systemPrompt).toContain('한국어');
			expect(systemPrompt).toContain('MUST write ALL notes');
		});

		it('should not append language instruction when summaryLanguage is auto', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();
			await step.execute(context);

			const [systemPrompt] = (mockProvider.summarize as ReturnType<typeof vi.fn>).mock.calls[0]!;
			expect(systemPrompt).not.toContain('MUST write ALL notes');
		});

		it('should call onProgress callback', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const onProgress = vi.fn();
			const context = createMockContext({ onProgress });
			await step.execute(context);

			expect(onProgress).toHaveBeenCalledWith('summarizing', 1, 1);
		});

		it('should throw ConfigError when LLM provider not found', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(undefined);

			const context = createMockContext();

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow(/LLM provider not found/);
		});

		it('should throw DataError when transcriptionResult is missing', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext({ transcriptionResult: undefined });

			await expect(step.execute(context)).rejects.toThrow(DataError);
			await expect(step.execute(context)).rejects.toThrow(/No transcription result/);
		});

		it('should throw ConfigError when LLM API key is empty', async () => {
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext({
				settings: {
					...createMockContext().settings,
					llmApiKey: '',
				},
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow(/LLM API key/);
		});

		it('should propagate provider errors', async () => {
			mockProvider = createMockProvider({
				summarize: vi.fn().mockRejectedValue(new Error('API call failed')),
			});
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue(mockProvider);

			const context = createMockContext();

			await expect(step.execute(context)).rejects.toThrow('API call failed');
		});
	});
});
