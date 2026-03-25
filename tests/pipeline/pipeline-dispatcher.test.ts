import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext, PipelineStep, PipelineCallbacks } from '../../src/pipeline/pipeline-types';

// Configurable mock behavior
let pipelineExecuteImpl: (
	steps: PipelineStep[],
	context: PipelineContext,
	callbacks?: PipelineCallbacks,
) => Promise<{ context: PipelineContext; failedStepIndex?: number }>;

function defaultPipelineExecute(
	steps: PipelineStep[],
	context: PipelineContext,
	callbacks?: PipelineCallbacks,
): Promise<{ context: PipelineContext; failedStepIndex?: number }> {
	for (let i = 0; i < steps.length; i++) {
		callbacks?.onStepStart?.(i, steps[i]!.name);
		callbacks?.onStepComplete?.(i, steps[i]!.name);
	}
	callbacks?.onComplete?.(context);
	return Promise.resolve({ context });
}

vi.mock('../../src/pipeline/pipeline', () => ({
	Pipeline: vi.fn().mockImplementation(() => ({
		execute: vi.fn((steps: PipelineStep[], context: PipelineContext, callbacks?: PipelineCallbacks) => {
			return pipelineExecuteImpl(steps, context, callbacks);
		}),
	})),
}));

vi.mock('../../src/pipeline/steps/transcribe-step', () => ({
	TranscribeStep: vi.fn().mockImplementation(() => ({ name: 'transcribe', execute: vi.fn() })),
}));

vi.mock('../../src/pipeline/steps/summarize-step', () => ({
	SummarizeStep: vi.fn().mockImplementation(() => ({ name: 'summarize', execute: vi.fn() })),
}));

vi.mock('../../src/pipeline/steps/generate-note-step', () => ({
	GenerateNoteStep: vi.fn().mockImplementation(() => ({ name: 'generate-note', execute: vi.fn() })),
}));

vi.mock('../../src/transcript/transcript-data', () => ({
	loadTranscriptData: vi.fn().mockResolvedValue(null),
	saveTranscriptData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { PipelineDispatcher } from '../../src/pipeline/pipeline-dispatcher';
import { SessionManager } from '../../src/session/session-manager';
import { loadTranscriptData } from '../../src/transcript/transcript-data';
import type { MeetingScribeSettings } from '../../src/settings/settings';

function createMockVault(transcriptPaths: string[] = []): PipelineContext['vault'] {
	return {
		getFiles: vi.fn().mockReturnValue([]),
		adapter: {
			exists: vi.fn().mockResolvedValue(false),
			read: vi.fn(),
			write: vi.fn(),
			list: vi.fn().mockResolvedValue({
				files: transcriptPaths,
				folders: [],
			}),
		},
	} as unknown as PipelineContext['vault'];
}

function createMockSettings(): MeetingScribeSettings {
	return { enableSummary: true } as MeetingScribeSettings;
}

describe('PipelineDispatcher', () => {
	let sessionManager: SessionManager;
	let vault: PipelineContext['vault'];
	let settings: MeetingScribeSettings;
	let dispatcher: PipelineDispatcher;

	beforeEach(() => {
		vi.clearAllMocks();
		pipelineExecuteImpl = defaultPipelineExecute;
		sessionManager = new SessionManager();
		vault = createMockVault();
		settings = createMockSettings();
		dispatcher = new PipelineDispatcher(sessionManager, vault, () => settings);
	});

	describe('dispatch', () => {
		it('creates a session and returns sessionId', async () => {
			const sessionId = await dispatcher.dispatch('audio/test.webm');

			expect(sessionId).toBeDefined();
			expect(typeof sessionId).toBe('string');
		});

		it('starts pipeline immediately when under concurrent limit', async () => {
			const sessionId = await dispatcher.dispatch('audio/test.webm');

			// Pipeline executes synchronously in the mock, so session should be complete
			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'complete';
			});
		});

		it('executes pipeline with all 3 steps', async () => {
			let capturedSteps: PipelineStep[] = [];
			pipelineExecuteImpl = async (steps, context, callbacks) => {
				capturedSteps = steps;
				return defaultPipelineExecute(steps, context, callbacks);
			};

			await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => expect(capturedSteps.length).toBe(3));
			expect(capturedSteps[0]!.name).toBe('transcribe');
			expect(capturedSteps[1]!.name).toBe('summarize');
			expect(capturedSteps[2]!.name).toBe('generate-note');
		});

		it('returns unique session IDs for multiple dispatches', async () => {
			const id1 = await dispatcher.dispatch('audio/test1.webm');
			const id2 = await dispatcher.dispatch('audio/test2.webm');

			expect(id1).not.toBe(id2);
		});
	});

	describe('concurrent session limit', () => {
		it('queues 4th session when 3 are already running', async () => {
			const resolvers: Array<() => void> = [];

			pipelineExecuteImpl = (_steps, context, _callbacks) => {
				return new Promise((resolve) => {
					resolvers.push(() => resolve({ context }));
				});
			};

			const id1 = await dispatcher.dispatch('audio/1.webm');
			const id2 = await dispatcher.dispatch('audio/2.webm');
			const id3 = await dispatcher.dispatch('audio/3.webm');
			const id4 = await dispatcher.dispatch('audio/4.webm');

			// 4th session should be queued
			const session4 = sessionManager.getSession(id4);
			expect(session4!.pipeline.status).toBe('queued');

			// First 3 should be active (transcribing)
			const session1 = sessionManager.getSession(id1);
			const session2 = sessionManager.getSession(id2);
			const session3 = sessionManager.getSession(id3);
			expect(session1!.pipeline.status).toBe('transcribing');
			expect(session2!.pipeline.status).toBe('transcribing');
			expect(session3!.pipeline.status).toBe('transcribing');

			// Clean up — resolve all to avoid hanging
			for (const resolve of resolvers) resolve();
		});

		it('auto-starts queued session when a running session completes', async () => {
			const resolvers: Array<{
				resolve: (value: { context: PipelineContext }) => void;
				callbacks?: PipelineCallbacks;
			}> = [];

			pipelineExecuteImpl = (_steps, context, callbacks) => {
				return new Promise((resolve) => {
					resolvers.push({ resolve, callbacks });
				});
			};

			await dispatcher.dispatch('audio/1.webm');
			await dispatcher.dispatch('audio/2.webm');
			await dispatcher.dispatch('audio/3.webm');
			const id4 = await dispatcher.dispatch('audio/4.webm');

			// 4th is queued
			expect(sessionManager.getSession(id4)!.pipeline.status).toBe('queued');

			// Complete first session
			const first = resolvers[0]!;
			first.callbacks?.onComplete?.({} as PipelineContext);
			first.resolve({ context: {} as PipelineContext });

			// Allow microtasks to process
			await new Promise(resolve => setTimeout(resolve, 10));

			// 4th should now be running (transcribing)
			const session4 = sessionManager.getSession(id4);
			expect(session4!.pipeline.status).toBe('transcribing');

			// Clean up remaining
			for (let i = 1; i < resolvers.length; i++) {
				resolvers[i]!.resolve({ context: {} as PipelineContext });
			}
		});
	});

	describe('retrySession', () => {
		it('resumes from failed step using completedSteps', async () => {
			let callCount = 0;

			pipelineExecuteImpl = async (steps, context, callbacks) => {
				callCount++;
				if (callCount === 1) {
					// First call: succeed transcribe, fail at summarize
					callbacks?.onStepStart?.(0, steps[0]!.name);
					callbacks?.onStepComplete?.(0, steps[0]!.name);
					callbacks?.onStepStart?.(1, steps[1]!.name);
					const error = new Error('API timeout');
					callbacks?.onError?.(1, steps[1]!.name, error);
					return { context, failedStepIndex: 1 };
				}
				// Second call (retry): should get remaining steps starting from summarize
				for (let i = 0; i < steps.length; i++) {
					callbacks?.onStepStart?.(i, steps[i]!.name);
					callbacks?.onStepComplete?.(i, steps[i]!.name);
				}
				callbacks?.onComplete?.(context);
				return { context };
			};

			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'error';
			});

			const failedSession = sessionManager.getSession(sessionId);
			expect(failedSession!.pipeline.completedSteps).toContain('transcribe');
			expect(failedSession!.pipeline.failedStep).toBe('summarize');

			// Retry
			await dispatcher.retrySession(sessionId);

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'complete';
			});

			expect(callCount).toBe(2);
		});

		it('skips completed steps on retry', async () => {
			let retryStepNames: string[] = [];
			let callCount = 0;

			pipelineExecuteImpl = async (steps, context, callbacks) => {
				callCount++;
				if (callCount === 1) {
					callbacks?.onStepStart?.(0, steps[0]!.name);
					callbacks?.onStepComplete?.(0, steps[0]!.name);
					const error = new Error('fail');
					callbacks?.onError?.(1, steps[1]!.name, error);
					return { context, failedStepIndex: 1 };
				}
				retryStepNames = steps.map(s => s.name);
				for (let i = 0; i < steps.length; i++) {
					callbacks?.onStepStart?.(i, steps[i]!.name);
					callbacks?.onStepComplete?.(i, steps[i]!.name);
				}
				callbacks?.onComplete?.(context);
				return { context };
			};

			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const s = sessionManager.getSession(sessionId);
				return s?.pipeline.status === 'error';
			});

			await dispatcher.retrySession(sessionId);

			await vi.waitFor(() => {
				const s = sessionManager.getSession(sessionId);
				return s?.pipeline.status === 'complete';
			});

			// Retry should only have summarize and generate-note (transcribe was completed)
			expect(retryStepNames).toEqual(['summarize', 'generate-note']);
		});

		it('does nothing for non-existent session', async () => {
			await dispatcher.retrySession('non-existent-id');
			// Should not throw
		});
	});

	describe('recoverSessions', () => {
		it('creates error sessions for interrupted transcripts', async () => {
			const mockVault = createMockVault(['audio/meeting1.webm.transcript.json']);

			(loadTranscriptData as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce({
					audioFile: 'audio/meeting1.webm',
					pipeline: {
						status: 'transcribing',
						progress: 30,
						completedSteps: [],
					},
					createdAt: '2026-01-15T10:00:00.000Z',
				});

			const recoveryDispatcher = new PipelineDispatcher(sessionManager, mockVault, () => settings);
			const recovered = await recoveryDispatcher.recoverSessions();

			expect(recovered).toBe(1);

			const sessions = sessionManager.getAllSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0]!.pipeline.status).toBe('error');
			expect(sessions[0]!.pipeline.error).toContain('interrupted');
		});

		it('recovers summarizing sessions as error', async () => {
			const mockVault = createMockVault(['audio/meeting.webm.transcript.json']);

			(loadTranscriptData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				audioFile: 'audio/meeting.webm',
				pipeline: {
					status: 'summarizing',
					progress: 60,
					completedSteps: ['transcribe'],
					failedStep: undefined,
				},
				createdAt: '2026-01-15T10:00:00.000Z',
			});

			const recoveryDispatcher = new PipelineDispatcher(sessionManager, mockVault, () => settings);
			const recovered = await recoveryDispatcher.recoverSessions();

			expect(recovered).toBe(1);
			const sessions = sessionManager.getAllSessions();
			expect(sessions[0]!.pipeline.completedSteps).toContain('transcribe');
		});

		it('recovers complete transcripts as complete sessions', async () => {
			const mockVault = createMockVault(['audio/done.webm.transcript.json']);

			(loadTranscriptData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				audioFile: 'audio/done.webm',
				pipeline: {
					status: 'complete',
					progress: 100,
					completedSteps: ['transcribe', 'summarize', 'generate-note'],
					noteFilePath: 'Meeting Notes/done.md',
				},
				createdAt: '2026-01-15T10:00:00.000Z',
			});

			const recoveryDispatcher = new PipelineDispatcher(sessionManager, mockVault, () => settings);
			const recovered = await recoveryDispatcher.recoverSessions();

			expect(recovered).toBe(1);
			const sessions = sessionManager.getAllSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0]!.pipeline.status).toBe('complete');
			expect(sessions[0]!.pipeline.noteFilePath).toBe('Meeting Notes/done.md');
		});

		it('recovers error transcripts preserving error state', async () => {
			const mockVault = createMockVault(['audio/failed.webm.transcript.json']);

			(loadTranscriptData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				audioFile: 'audio/failed.webm',
				pipeline: {
					status: 'error',
					progress: 30,
					completedSteps: ['transcribe'],
					error: 'API rate limit exceeded',
					failedStep: 'summarize',
				},
				createdAt: '2026-01-15T10:00:00.000Z',
			});

			const recoveryDispatcher = new PipelineDispatcher(sessionManager, mockVault, () => settings);
			const recovered = await recoveryDispatcher.recoverSessions();

			expect(recovered).toBe(1);
			const sessions = sessionManager.getAllSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0]!.pipeline.status).toBe('error');
			expect(sessions[0]!.pipeline.error).toBe('API rate limit exceeded');
		});

		it('handles load failures gracefully', async () => {
			const mockVault = createMockVault(['audio/corrupt.webm.transcript.json']);

			(loadTranscriptData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

			const recoveryDispatcher = new PipelineDispatcher(sessionManager, mockVault, () => settings);
			const recovered = await recoveryDispatcher.recoverSessions();

			expect(recovered).toBe(0);
		});

		it('returns 0 when no transcript files exist', async () => {
			const recovered = await dispatcher.recoverSessions();
			expect(recovered).toBe(0);
		});
	});

	describe('abortAll', () => {
		it('marks active sessions for abort', async () => {
			const resolvers: Array<{
				resolve: (value: { context: PipelineContext }) => void;
				isAborted?: () => boolean;
			}> = [];

			pipelineExecuteImpl = (_steps, context, _callbacks) => {
				return new Promise((resolve) => {
					resolvers.push({ resolve, isAborted: context.isAborted });
				});
			};

			await dispatcher.dispatch('audio/1.webm');

			// Abort all
			dispatcher.abortAll();

			// isAborted should now return true for the running session
			expect(resolvers[0]!.isAborted?.()).toBe(true);

			// Clean up
			resolvers[0]!.resolve({ context: {} as PipelineContext });
		});

		it('clears the queue', async () => {
			const resolvers: Array<{ resolve: (value: { context: PipelineContext }) => void }> = [];

			pipelineExecuteImpl = (_steps, context, _callbacks) => {
				return new Promise((resolve) => {
					resolvers.push({ resolve });
				});
			};

			await dispatcher.dispatch('audio/1.webm');
			await dispatcher.dispatch('audio/2.webm');
			await dispatcher.dispatch('audio/3.webm');
			const id4 = await dispatcher.dispatch('audio/4.webm');

			expect(sessionManager.getSession(id4)!.pipeline.status).toBe('queued');

			dispatcher.abortAll();

			// Queued session should be transitioned to error
			const session4AfterAbort = sessionManager.getSession(id4);
			expect(session4AfterAbort!.pipeline.status).toBe('error');
			expect(session4AfterAbort!.pipeline.error).toBe('Pipeline aborted');

			// Complete session 1 — should NOT dequeue session 4
			resolvers[0]!.resolve({ context: {} as PipelineContext });
			await new Promise(resolve => setTimeout(resolve, 10));

			// Clean up
			for (const r of resolvers) r.resolve({ context: {} as PipelineContext });
		});
	});

	describe('per-session abort', () => {
		it('uses isAborted closure scoped to sessionId', async () => {
			let capturedIsAborted: (() => boolean) | undefined;

			pipelineExecuteImpl = async (steps, context, callbacks) => {
				capturedIsAborted = context.isAborted;
				return defaultPipelineExecute(steps, context, callbacks);
			};

			await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => expect(capturedIsAborted).toBeDefined());
			expect(capturedIsAborted!()).toBe(false);
		});
	});

	describe('session state tracking', () => {
		it('updates completedSteps after each successful step', async () => {
			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'complete';
			});

			const session = sessionManager.getSession(sessionId);
			expect(session!.pipeline.completedSteps).toContain('transcribe');
			expect(session!.pipeline.completedSteps).toContain('summarize');
			expect(session!.pipeline.completedSteps).toContain('generate-note');
		});

		it('sets session to complete status after all steps succeed', async () => {
			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'complete';
			});

			const session = sessionManager.getSession(sessionId);
			expect(session!.pipeline.status).toBe('complete');
			expect(session!.pipeline.progress).toBe(100);
		});

		it('propagates noteFilePath from pipeline context to session on complete', async () => {
			pipelineExecuteImpl = async (steps, context, callbacks) => {
				const enrichedContext = { ...context, noteFilePath: 'notes/Meeting 2026-03-24.md' };
				for (let i = 0; i < steps.length; i++) {
					callbacks?.onStepStart?.(i, steps[i]!.name);
					callbacks?.onStepComplete?.(i, steps[i]!.name);
				}
				callbacks?.onComplete?.(enrichedContext);
				return { context: enrichedContext };
			};

			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'complete';
			});

			const session = sessionManager.getSession(sessionId);
			expect(session!.pipeline.noteFilePath).toBe('notes/Meeting 2026-03-24.md');
		});

		it('sets error state with failedStep on pipeline failure', async () => {
			pipelineExecuteImpl = async (steps, context, callbacks) => {
				callbacks?.onStepStart?.(0, steps[0]!.name);
				callbacks?.onStepComplete?.(0, steps[0]!.name);
				const error = new Error('LLM timeout');
				callbacks?.onError?.(1, steps[1]!.name, error);
				return { context, failedStepIndex: 1 };
			};

			const sessionId = await dispatcher.dispatch('audio/test.webm');

			await vi.waitFor(() => {
				const session = sessionManager.getSession(sessionId);
				return session?.pipeline.status === 'error';
			});

			const session = sessionManager.getSession(sessionId);
			expect(session!.pipeline.status).toBe('error');
			expect(session!.pipeline.failedStep).toBe('summarize');
			expect(session!.pipeline.error).toBe('LLM timeout');
		});
	});
});
