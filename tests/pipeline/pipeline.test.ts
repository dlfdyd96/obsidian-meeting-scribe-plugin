import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext, PipelineStep } from '../../src/pipeline/pipeline-types';
import { PluginState } from '../../src/state/types';

vi.mock('../../src/state/state-manager', () => ({
	stateManager: {
		setState: vi.fn(),
		getState: vi.fn().mockReturnValue(PluginState.Idle),
		getContext: vi.fn().mockReturnValue({}),
	},
}));

vi.mock('../../src/utils/retry', () => ({
	retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { Pipeline } from '../../src/pipeline/pipeline';
import { stateManager } from '../../src/state/state-manager';
import { retryWithBackoff } from '../../src/utils/retry';
import { TransientError, ConfigError, DataError } from '../../src/utils/errors';

function createMockContext(overrides?: Partial<PipelineContext>): PipelineContext {
	return {
		audioFilePath: 'test/audio.webm',
		vault: {} as PipelineContext['vault'],
		settings: {} as PipelineContext['settings'],
		...overrides,
	};
}

function createMockStep(
	name: string,
	modifier?: Partial<PipelineContext>,
): PipelineStep {
	return {
		name,
		execute: vi.fn(async (ctx: PipelineContext) => ({ ...ctx, ...modifier })),
	};
}

describe('Pipeline', () => {
	let pipeline: Pipeline;

	beforeEach(() => {
		vi.clearAllMocks();
		pipeline = new Pipeline();
	});

	describe('successful execution', () => {
		it('executes steps sequentially and returns final context', async () => {
			const step1 = createMockStep('transcribe', {
				transcriptionResult: { fullText: 'hello' } as PipelineContext['transcriptionResult'],
			});
			const step2 = createMockStep('summarize', {
				summaryResult: { summary: 'summary' } as PipelineContext['summaryResult'],
			});
			const step3 = createMockStep('generate-note', {
				noteFilePath: 'notes/test.md',
			});

			const context = createMockContext();
			const result = await pipeline.execute([step1, step2, step3], context);

			expect(result.failedStepIndex).toBeUndefined();
			expect(result.context.noteFilePath).toBe('notes/test.md');
			expect(result.context.transcriptionResult).toBeDefined();
			expect(result.context.summaryResult).toBeDefined();
		});

		it('passes enriched context from step N to step N+1', async () => {
			const step1 = createMockStep('transcribe', {
				transcriptionResult: { fullText: 'text' } as PipelineContext['transcriptionResult'],
			});
			const step2 = createMockStep('summarize');

			const context = createMockContext();
			await pipeline.execute([step1, step2], context);

			const step2Call = (step2.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PipelineContext;
			expect(step2Call.transcriptionResult).toBeDefined();
			expect(step2Call.transcriptionResult!.fullText).toBe('text');
		});
	});

	describe('state transitions', () => {
		it('transitions Processing → Complete on success', async () => {
			const step1 = createMockStep('transcribe', { noteFilePath: 'notes/out.md' });

			const context = createMockContext();
			await pipeline.execute([step1], context);

			const setCalls = (stateManager.setState as ReturnType<typeof vi.fn>).mock.calls;

			// First call: Processing with step info
			expect(setCalls[0]![0]).toBe(PluginState.Processing);
			expect(setCalls[0]![1]).toEqual(
				expect.objectContaining({ step: 'transcribe' }),
			);

			// Last call: Complete with noteFilePath
			const lastCall = setCalls[setCalls.length - 1]!;
			expect(lastCall[0]).toBe(PluginState.Complete);
			expect(lastCall[1]).toEqual(
				expect.objectContaining({ noteFilePath: 'notes/out.md' }),
			);
		});

		it('updates state with step name and progress for each step', async () => {
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');
			const step3 = createMockStep('generate-note');

			const context = createMockContext();
			await pipeline.execute([step1, step2, step3], context);

			const setCalls = (stateManager.setState as ReturnType<typeof vi.fn>).mock.calls;

			// Step 1: progress 1
			expect(setCalls[0]).toEqual([
				PluginState.Processing,
				expect.objectContaining({ step: 'transcribe', progress: 1, totalSteps: 3 }),
			]);
			// Step 2: progress 2
			expect(setCalls[1]).toEqual([
				PluginState.Processing,
				expect.objectContaining({ step: 'summarize', progress: 2, totalSteps: 3 }),
			]);
			// Step 3: progress 3
			expect(setCalls[2]).toEqual([
				PluginState.Processing,
				expect.objectContaining({ step: 'generate-note', progress: 3, totalSteps: 3 }),
			]);
		});
	});

	describe('progress tracking', () => {
		it('invokes onProgress callback for each step', async () => {
			const onProgress = vi.fn();
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');

			const context = createMockContext({ onProgress });
			await pipeline.execute([step1, step2], context);

			expect(onProgress).toHaveBeenCalledTimes(2);
			expect(onProgress).toHaveBeenCalledWith('transcribe', 1, 2);
			expect(onProgress).toHaveBeenCalledWith('summarize', 2, 2);
		});
	});

	describe('retry integration', () => {
		it('wraps each step execution with retryWithBackoff', async () => {
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');

			const context = createMockContext();
			await pipeline.execute([step1, step2], context);

			expect(retryWithBackoff).toHaveBeenCalledTimes(2);
		});

		it('transitions to Error when TransientError exhausts retries', async () => {
			const error = new TransientError('API timeout');
			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			// Make retryWithBackoff propagate the error
			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context);

			expect(result.failedStepIndex).toBe(0);

			const setCalls = (stateManager.setState as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = setCalls[setCalls.length - 1]!;
			expect(lastCall[0]).toBe(PluginState.Error);
			expect(lastCall[1]).toEqual(
				expect.objectContaining({ step: 'transcribe' }),
			);
			expect(lastCall[1].error).toBeInstanceOf(TransientError);
		});
	});

	describe('non-retryable errors', () => {
		it('transitions to Error immediately on ConfigError', async () => {
			const error = new ConfigError('Invalid API key');

			// retryWithBackoff rethrows non-retryable errors immediately
			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'summarize',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context);

			expect(result.failedStepIndex).toBe(0);

			const setCalls = (stateManager.setState as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = setCalls[setCalls.length - 1]!;
			expect(lastCall[0]).toBe(PluginState.Error);
			expect(lastCall[1].error).toBeInstanceOf(ConfigError);
		});

		it('transitions to Error immediately on DataError', async () => {
			const error = new DataError('Audio file not found');

			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context);

			expect(result.failedStepIndex).toBe(0);

			const setCalls = (stateManager.setState as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = setCalls[setCalls.length - 1]!;
			expect(lastCall[0]).toBe(PluginState.Error);
			expect(lastCall[1].error).toBeInstanceOf(DataError);
		});
	});

	describe('partial failure', () => {
		it('records failedStepIndex when middle step fails', async () => {
			const step1 = createMockStep('transcribe', {
				transcriptionResult: { fullText: 'text' } as PipelineContext['transcriptionResult'],
			});

			const error = new TransientError('LLM unavailable');
			const failingStep: PipelineStep = {
				name: 'summarize',
				execute: vi.fn().mockRejectedValue(error),
			};

			// First call succeeds (step1), second call fails (step2)
			(retryWithBackoff as ReturnType<typeof vi.fn>)
				.mockImplementationOnce((fn: () => unknown) => fn())
				.mockRejectedValueOnce(error);

			const step3 = createMockStep('generate-note');

			const context = createMockContext();
			const result = await pipeline.execute([step1, failingStep, step3], context);

			expect(result.failedStepIndex).toBe(1);
			// step3 should NOT have been called
			expect(step3.execute).not.toHaveBeenCalled();
		});
	});

	describe('onProgress callback', () => {
		it('uses enriched context onProgress, not original', async () => {
			const originalOnProgress = vi.fn();
			const enrichedOnProgress = vi.fn();

			const step1: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn(async (ctx: PipelineContext) => ({
					...ctx,
					onProgress: enrichedOnProgress,
				})),
			};
			const step2 = createMockStep('summarize');

			const context = createMockContext({ onProgress: originalOnProgress });
			await pipeline.execute([step1, step2], context);

			// Step 1 uses original callback (currentContext === original context at that point)
			expect(originalOnProgress).toHaveBeenCalledWith('transcribe', 1, 2);
			// Step 2 uses enriched callback from step1's returned context
			expect(enrichedOnProgress).toHaveBeenCalledWith('summarize', 2, 2);
		});

		it('works when onProgress is undefined', async () => {
			const step1 = createMockStep('transcribe');

			const context = createMockContext({ onProgress: undefined });
			const result = await pipeline.execute([step1], context);

			expect(result.failedStepIndex).toBeUndefined();
		});
	});
});
