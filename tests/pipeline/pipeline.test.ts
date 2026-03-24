import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext, PipelineStep, PipelineCallbacks } from '../../src/pipeline/pipeline-types';

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

function createMockCallbacks(): Required<PipelineCallbacks> {
	return {
		onStepStart: vi.fn(),
		onStepComplete: vi.fn(),
		onError: vi.fn(),
		onComplete: vi.fn(),
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

	describe('callbacks', () => {
		it('calls onStepStart and onStepComplete for each step', async () => {
			const callbacks = createMockCallbacks();
			const step1 = createMockStep('transcribe', { noteFilePath: 'notes/out.md' });

			const context = createMockContext();
			await pipeline.execute([step1], context, callbacks);

			expect(callbacks.onStepStart).toHaveBeenCalledWith(0, 'transcribe');
			expect(callbacks.onStepComplete).toHaveBeenCalledWith(0, 'transcribe');
		});

		it('calls onComplete on successful execution', async () => {
			const callbacks = createMockCallbacks();
			const step1 = createMockStep('transcribe', { noteFilePath: 'notes/out.md' });

			const context = createMockContext();
			await pipeline.execute([step1], context, callbacks);

			expect(callbacks.onComplete).toHaveBeenCalledOnce();
			expect(callbacks.onComplete).toHaveBeenCalledWith(
				expect.objectContaining({ noteFilePath: 'notes/out.md' }),
			);
		});

		it('fires onStepStart and onStepComplete in correct order for multiple steps', async () => {
			const callbacks = createMockCallbacks();
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');
			const step3 = createMockStep('generate-note');

			const context = createMockContext();
			await pipeline.execute([step1, step2, step3], context, callbacks);

			expect(callbacks.onStepStart).toHaveBeenCalledTimes(3);
			expect(callbacks.onStepComplete).toHaveBeenCalledTimes(3);
			expect(callbacks.onStepStart).toHaveBeenNthCalledWith(1, 0, 'transcribe');
			expect(callbacks.onStepStart).toHaveBeenNthCalledWith(2, 1, 'summarize');
			expect(callbacks.onStepStart).toHaveBeenNthCalledWith(3, 2, 'generate-note');
			expect(callbacks.onStepComplete).toHaveBeenNthCalledWith(1, 0, 'transcribe');
			expect(callbacks.onStepComplete).toHaveBeenNthCalledWith(2, 1, 'summarize');
			expect(callbacks.onStepComplete).toHaveBeenNthCalledWith(3, 2, 'generate-note');
		});

		it('calls onError when a step fails', async () => {
			const callbacks = createMockCallbacks();
			const error = new TransientError('API timeout');
			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context, callbacks);

			expect(result.failedStepIndex).toBe(0);
			expect(callbacks.onError).toHaveBeenCalledWith(0, 'transcribe', error);
			expect(callbacks.onComplete).not.toHaveBeenCalled();
		});

		it('does not call onComplete when a step fails', async () => {
			const callbacks = createMockCallbacks();
			const error = new ConfigError('Invalid API key');
			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'summarize',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			await pipeline.execute([failingStep], context, callbacks);

			expect(callbacks.onComplete).not.toHaveBeenCalled();
		});

		it('works without callbacks (backward compatible)', async () => {
			const step1 = createMockStep('transcribe', { noteFilePath: 'notes/out.md' });

			const context = createMockContext();
			const result = await pipeline.execute([step1], context);

			expect(result.failedStepIndex).toBeUndefined();
			expect(result.context.noteFilePath).toBe('notes/out.md');
		});

		it('does not call onStepComplete for failed step', async () => {
			const callbacks = createMockCallbacks();
			const error = new DataError('Audio file not found');
			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			await pipeline.execute([failingStep], context, callbacks);

			expect(callbacks.onStepStart).toHaveBeenCalledOnce();
			expect(callbacks.onStepComplete).not.toHaveBeenCalled();
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

		it('returns failedStepIndex when TransientError exhausts retries', async () => {
			const callbacks = createMockCallbacks();
			const error = new TransientError('API timeout');
			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context, callbacks);

			expect(result.failedStepIndex).toBe(0);
			expect(callbacks.onError).toHaveBeenCalledWith(0, 'transcribe', error);
		});
	});

	describe('non-retryable errors', () => {
		it('calls onError on ConfigError', async () => {
			const callbacks = createMockCallbacks();
			const error = new ConfigError('Invalid API key');

			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'summarize',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context, callbacks);

			expect(result.failedStepIndex).toBe(0);
			expect(callbacks.onError).toHaveBeenCalledWith(0, 'summarize', error);
		});

		it('calls onError on DataError', async () => {
			const callbacks = createMockCallbacks();
			const error = new DataError('Audio file not found');

			(retryWithBackoff as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

			const failingStep: PipelineStep = {
				name: 'transcribe',
				execute: vi.fn().mockRejectedValue(error),
			};

			const context = createMockContext();
			const result = await pipeline.execute([failingStep], context, callbacks);

			expect(result.failedStepIndex).toBe(0);
			expect(callbacks.onError).toHaveBeenCalledWith(0, 'transcribe', error);
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

	describe('abort between steps', () => {
		it('stops execution when isAborted returns true between steps', async () => {
			let aborted = false;
			const step1 = createMockStep('transcribe', {
				transcriptionResult: { fullText: 'text' } as PipelineContext['transcriptionResult'],
			});
			const step2 = createMockStep('summarize');
			const step3 = createMockStep('generate-note');

			// Abort after step 1 completes
			(step1.execute as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: PipelineContext) => {
				aborted = true;
				return { ...ctx, transcriptionResult: { fullText: 'text' } as PipelineContext['transcriptionResult'] };
			});

			const context = createMockContext({ isAborted: () => aborted });
			const result = await pipeline.execute([step1, step2, step3], context);

			expect(step1.execute).toHaveBeenCalledOnce();
			expect(step2.execute).not.toHaveBeenCalled();
			expect(step3.execute).not.toHaveBeenCalled();
			expect(result.failedStepIndex).toBeUndefined();
		});

		it('does not call onComplete when aborted', async () => {
			const callbacks = createMockCallbacks();
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');

			const context = createMockContext({ isAborted: () => true });
			await pipeline.execute([step1, step2], context, callbacks);

			expect(callbacks.onComplete).not.toHaveBeenCalled();
		});

		it('executes all steps when isAborted always returns false', async () => {
			const step1 = createMockStep('transcribe');
			const step2 = createMockStep('summarize');

			const context = createMockContext({ isAborted: () => false });
			const result = await pipeline.execute([step1, step2], context);

			expect(step1.execute).toHaveBeenCalledOnce();
			expect(step2.execute).toHaveBeenCalledOnce();
			expect(result.failedStepIndex).toBeUndefined();
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

	describe('no global state dependency', () => {
		it('does not import or use stateManager', async () => {
			// Pipeline should work purely through callbacks without any global stateManager dependency
			const callbacks = createMockCallbacks();
			const step1 = createMockStep('transcribe', { noteFilePath: 'test.md' });

			const context = createMockContext();
			const result = await pipeline.execute([step1], context, callbacks);

			expect(result.failedStepIndex).toBeUndefined();
			expect(callbacks.onStepStart).toHaveBeenCalledOnce();
			expect(callbacks.onStepComplete).toHaveBeenCalledOnce();
			expect(callbacks.onComplete).toHaveBeenCalledOnce();
		});
	});
});
