import type { PipelineContext, PipelineStep, PipelineResult, PipelineCallbacks } from './pipeline-types';
import { retryWithBackoff } from '../utils/retry';
import { logger } from '../utils/logger';

const COMPONENT = 'Pipeline';

export class Pipeline {
	async execute(
		steps: PipelineStep[],
		context: PipelineContext,
		callbacks?: PipelineCallbacks,
	): Promise<PipelineResult> {
		logger.info(COMPONENT, 'Pipeline started', {
			stepCount: steps.length,
			audioFilePath: context.audioFilePath,
		});

		let currentContext = context;

		for (let i = 0; i < steps.length; i++) {
			if (currentContext.isAborted?.()) {
				logger.info(COMPONENT, 'Pipeline aborted between steps', { completedSteps: i });
				return { context: currentContext };
			}

			const step = steps[i]!;

			callbacks?.onStepStart?.(i, step.name);
			currentContext.onProgress?.(step.name, i + 1, steps.length);

			logger.info(COMPONENT, `Executing step ${i + 1}/${steps.length}: ${step.name}`);

			try {
				currentContext = await retryWithBackoff(() => step.execute(currentContext));
				callbacks?.onStepComplete?.(i, step.name);
			} catch (error: unknown) {
				const err = error instanceof Error ? error : new Error(String(error));
				logger.error(COMPONENT, `Step failed: ${step.name}`, {
					error: err.message,
					stepIndex: i,
				});
				callbacks?.onError?.(i, step.name, err);
				return { context: currentContext, failedStepIndex: i };
			}
		}

		callbacks?.onComplete?.(currentContext);

		logger.info(COMPONENT, 'Pipeline completed', {
			noteFilePath: currentContext.noteFilePath,
		});

		return { context: currentContext };
	}
}
