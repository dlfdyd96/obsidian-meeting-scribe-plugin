import type { Vault } from 'obsidian';
import type { MeetingScribeSettings } from '../settings/settings';
import type { PipelineCallbacks, PipelineContext } from './pipeline-types';
import { Pipeline } from './pipeline';
import { TranscribeStep } from './steps/transcribe-step';
import { SummarizeStep } from './steps/summarize-step';
import { GenerateNoteStep } from './steps/generate-note-step';
import { SessionManager } from '../session/session-manager';
import { saveTranscriptData, loadTranscriptData } from '../transcript/transcript-data';
import type { TranscriptData } from '../transcript/transcript-data';
import { MAX_CONCURRENT_SESSIONS } from '../constants';
import { logger } from '../utils/logger';

const COMPONENT = 'PipelineDispatcher';

const STEP_NAMES = ['transcribe', 'summarize', 'generate-note'] as const;
const STATUS_MAP: Record<string, 'transcribing' | 'summarizing'> = {
	'transcribe': 'transcribing',
	'summarize': 'summarizing',
	'generate-note': 'summarizing',
};

interface QueueEntry {
	sessionId: string;
	audioFilePath: string;
	startFromStep: number;
}

export class PipelineDispatcher {
	private runningCount = 0;
	private queue: QueueEntry[] = [];
	private abortedSessions: Set<string> = new Set();

	constructor(
		private sessionManager: SessionManager,
		private vault: Vault,
		private getSettings: () => MeetingScribeSettings,
	) {}

	async dispatch(audioFilePath: string, existingSessionId?: string): Promise<string> {
		let sessionId: string;
		if (existingSessionId) {
			sessionId = existingSessionId;
			this.sessionManager.updateSessionState(sessionId, {
				status: 'transcribing',
				progress: 0,
			});
		} else {
			const session = this.sessionManager.createSession(audioFilePath);
			sessionId = session.id;
		}

		logger.info(COMPONENT, 'Dispatching pipeline', { sessionId, audioFilePath });

		if (this.runningCount < MAX_CONCURRENT_SESSIONS) {
			void this.executeSession(sessionId, audioFilePath, 0);
		} else {
			this.sessionManager.updateSessionState(sessionId, { status: 'queued' });
			this.queue.push({ sessionId, audioFilePath, startFromStep: 0 });
			logger.info(COMPONENT, 'Session queued', { sessionId, queueLength: this.queue.length });
		}

		return sessionId;
	}

	async retrySession(sessionId: string): Promise<void> {
		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			logger.error(COMPONENT, 'Cannot retry: session not found', { sessionId });
			return;
		}

		const completedSteps = session.pipeline.completedSteps;
		const startFromStep = completedSteps.length;

		logger.info(COMPONENT, 'Retrying session', {
			sessionId,
			completedSteps,
			startFromStep,
		});

		// Reset error state with correct status for the step we're resuming from
		const resumeStatus = STATUS_MAP[STEP_NAMES[startFromStep] ?? 'transcribe'] ?? 'transcribing';
		this.sessionManager.updateSessionState(sessionId, {
			status: resumeStatus,
			error: undefined,
			failedStep: undefined,
		});

		if (this.runningCount < MAX_CONCURRENT_SESSIONS) {
			void this.executeSession(sessionId, session.audioFile, startFromStep);
		} else {
			this.sessionManager.updateSessionState(sessionId, { status: 'queued' });
			this.queue.push({ sessionId, audioFilePath: session.audioFile, startFromStep });
		}
	}

	async recoverSessions(): Promise<number> {
		let recovered = 0;
		try {
			const transcriptFiles = await this.findTranscriptFiles();

			for (const filePath of transcriptFiles) {
				try {
					const data = await loadTranscriptData(this.vault, filePath);
					if (!data) continue;

					const status = data.pipeline.status;
					const title = this.deriveTitleFromData(data);

					if (status === 'transcribing' || status === 'summarizing' || status === 'queued') {
						const session = this.sessionManager.restoreSession({
							audioFile: data.audioFile,
							transcriptFile: filePath,
							title,
							pipeline: {
								...data.pipeline,
								status: 'error',
								error: 'Pipeline interrupted — app was closed during processing',
								failedStep: data.pipeline.failedStep ?? status,
							},
							createdAt: data.createdAt,
						});
						recovered++;
						logger.info(COMPONENT, 'Recovered interrupted session', {
							sessionId: session.id,
							audioFile: data.audioFile,
							previousStatus: status,
						});
					} else if (status === 'complete' || status === 'error') {
						this.sessionManager.restoreSession({
							audioFile: data.audioFile,
							transcriptFile: filePath,
							title,
							pipeline: data.pipeline,
							createdAt: data.createdAt,
						});
						recovered++;
						logger.info(COMPONENT, 'Recovered session', {
							audioFile: data.audioFile,
							status,
						});
					}
				} catch (err) {
					logger.warn(COMPONENT, 'Failed to recover transcript file', {
						path: filePath,
						error: (err as Error).message,
					});
				}
			}
		} catch (err) {
			logger.warn(COMPONENT, 'Session recovery scan failed', {
				error: (err as Error).message,
			});
		}

		if (recovered > 0) {
			logger.info(COMPONENT, 'Session recovery complete', { recovered });
		}
		return recovered;
	}

	abortAll(): void {
		for (const session of this.sessionManager.getActiveSessions()) {
			this.abortedSessions.add(session.id);
		}
		for (const entry of this.queue) {
			this.sessionManager.updateSessionState(entry.sessionId, {
				status: 'error',
				error: 'Pipeline aborted',
			});
		}
		this.queue = [];
		logger.info(COMPONENT, 'All sessions aborted');
	}

	private async executeSession(
		sessionId: string,
		audioFilePath: string,
		startFromStep: number,
	): Promise<void> {
		this.runningCount++;

		const allSteps = [new TranscribeStep(), new SummarizeStep(), new GenerateNoteStep()];
		const steps = allSteps.slice(startFromStep);

		if (steps.length === 0) {
			this.sessionManager.updateSessionState(sessionId, {
				status: 'complete',
				progress: 100,
			});
			this.runningCount--;
			this.dequeueNext();
			return;
		}

		// Update status for the first step being executed
		const firstStepStatus = STATUS_MAP[steps[0]!.name] ?? 'transcribing';
		this.sessionManager.updateSessionState(sessionId, {
			status: firstStepStatus,
			progress: 0,
		});

		const callbacks: PipelineCallbacks = {
			onStepStart: (_index, stepName) => {
				const mappedStatus = STATUS_MAP[stepName];
				if (mappedStatus) {
					this.sessionManager.updateSessionState(sessionId, { status: mappedStatus });
				}
			},
			onStepComplete: (_index, stepName) => {
				const session = this.sessionManager.getSession(sessionId);
				if (session) {
					const updatedSteps = [...session.pipeline.completedSteps, stepName];
					this.sessionManager.updateSessionState(sessionId, {
						completedSteps: updatedSteps,
					});
					// Persist pipeline state to JSON for crash recovery
					void this.persistPipelineState(sessionId);
				}
			},
			onError: (_index, stepName, error) => {
				this.sessionManager.updateSessionState(sessionId, {
					status: 'error',
					error: error.message,
					failedStep: stepName,
				});
				void this.persistPipelineState(sessionId);
			},
			onComplete: (context) => {
				this.sessionManager.updateSessionState(sessionId, {
					status: 'complete',
					progress: 100,
					noteFilePath: context.noteFilePath,
				});
				void this.persistPipelineState(sessionId);
			},
		};

		const context: PipelineContext = {
			audioFilePath,
			vault: this.vault,
			settings: this.getSettings(),
			onProgress: (step: string, current: number, total: number) => {
				logger.debug(COMPONENT, 'Pipeline progress', { sessionId, step, current, total });
			},
			isAborted: () => this.abortedSessions.has(sessionId),
		};

		const pipeline = new Pipeline();

		try {
			await pipeline.execute(steps, context, callbacks);
		} catch (err) {
			logger.error(COMPONENT, 'Unexpected pipeline error', {
				sessionId,
				error: (err as Error).message,
			});
			this.sessionManager.updateSessionState(sessionId, {
				status: 'error',
				error: (err as Error).message,
			});
		} finally {
			this.runningCount--;
			this.abortedSessions.delete(sessionId);
			this.dequeueNext();
		}
	}

	private dequeueNext(): void {
		if (this.queue.length === 0 || this.runningCount >= MAX_CONCURRENT_SESSIONS) {
			return;
		}

		const next = this.queue.shift()!;
		logger.info(COMPONENT, 'Dequeuing session', { sessionId: next.sessionId });
		void this.executeSession(next.sessionId, next.audioFilePath, next.startFromStep);
	}

	private async findTranscriptFiles(): Promise<string[]> {
		const result: string[] = [];
		const scan = async (folder: string): Promise<void> => {
			try {
				const listing = await this.vault.adapter.list(folder);
				for (const filePath of listing.files) {
					if (filePath.endsWith('.transcript.json')) {
						result.push(filePath);
					}
				}
				for (const subfolder of listing.folders) {
					await scan(subfolder);
				}
			} catch {
				// folder may not exist, skip
			}
		};
		await scan('');
		return result;
	}

	private deriveTitleFromData(data: TranscriptData): string {
		const date = new Date(data.createdAt);
		const dateStr = date.toISOString().slice(0, 10);
		const timeStr = date.toTimeString().slice(0, 5);
		return `Meeting ${dateStr} ${timeStr}`;
	}

	private async persistPipelineState(sessionId: string): Promise<void> {
		try {
			const session = this.sessionManager.getSession(sessionId);
			if (!session) return;

			const transcriptPath = session.transcriptFile;
			const existing = await loadTranscriptData(this.vault, transcriptPath);

			if (existing) {
				existing.pipeline = { ...session.pipeline };
				await saveTranscriptData(this.vault, transcriptPath, existing);
			}
		} catch (err) {
			logger.warn(COMPONENT, 'Failed to persist pipeline state', {
				sessionId,
				error: (err as Error).message,
			});
		}
	}
}
