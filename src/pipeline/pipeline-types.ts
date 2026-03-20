import type { Vault } from 'obsidian';
import type { MeetingScribeSettings } from '../settings/settings';
import type { TranscriptionResult, SummaryResult } from '../providers/types';

export interface PipelineContext {
	audioFilePath: string;
	vault: Vault;
	settings: MeetingScribeSettings;
	transcriptionResult?: TranscriptionResult;
	summaryResult?: SummaryResult;
	noteFilePath?: string;
	transcriptFilePath?: string;
	onProgress?: (step: string, current: number, total: number) => void;
	forceRetranscribe?: boolean;
	maxDurationOverride?: number;
	isAborted?: () => boolean;
}

export interface PipelineStep {
	readonly name: string;
	execute(context: PipelineContext): Promise<PipelineContext>;
}

export interface PipelineResult {
	context: PipelineContext;
	failedStepIndex?: number;
}
