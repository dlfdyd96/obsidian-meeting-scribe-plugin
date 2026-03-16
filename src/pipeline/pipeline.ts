import type { PipelineContext, PipelineStep, PipelineResult } from './pipeline-types';
import { stateManager } from '../state/state-manager';
import { PluginState } from '../state/types';
import { retryWithBackoff } from '../utils/retry';
import { logger } from '../utils/logger';

const COMPONENT = 'Pipeline';

export class Pipeline {
	async execute(
		steps: PipelineStep[],
		context: PipelineContext,
	): Promise<PipelineResult> {
		logger.info(COMPONENT, 'Pipeline started', {
			stepCount: steps.length,
			audioFilePath: context.audioFilePath,
		});

		let currentContext = context;

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i]!;

			stateManager.setState(PluginState.Processing, {
				step: step.name,
				progress: i + 1,
				totalSteps: steps.length,
			});

			currentContext.onProgress?.(step.name, i + 1, steps.length);

			logger.info(COMPONENT, `Executing step ${i + 1}/${steps.length}: ${step.name}`);

			try {
				currentContext = await retryWithBackoff(() => step.execute(currentContext));
			} catch (error: unknown) {
				const err = error instanceof Error ? error : new Error(String(error));
				logger.error(COMPONENT, `Step failed: ${step.name}`, {
					error: err.message,
					stepIndex: i,
				});
				stateManager.setState(PluginState.Error, {
					error: err,
					step: step.name,
				});
				return { context: currentContext, failedStepIndex: i };
			}
		}

		stateManager.setState(PluginState.Complete, {
			noteFilePath: currentContext.noteFilePath,
		});

		logger.info(COMPONENT, 'Pipeline completed', {
			noteFilePath: currentContext.noteFilePath,
		});

		return { context: currentContext };
	}
}
