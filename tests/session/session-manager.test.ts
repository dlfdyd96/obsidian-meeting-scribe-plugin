import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger';
import { SessionManager } from '../../src/session/session-manager';
import { DataError } from '../../src/utils/errors';
import type { MeetingSession } from '../../src/session/types';

vi.spyOn(logger, 'debug').mockImplementation(() => {});
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});

describe('SessionManager', () => {
	let manager: SessionManager;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));
		manager = new SessionManager();
	});

	afterEach(() => {
		manager.reset();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('createSession', () => {
		it('creates a session with unique ID and correct paths', () => {
			const session = manager.createSession('audio/meeting.webm');

			expect(session.id).toBeTruthy();
			expect(typeof session.id).toBe('string');
			expect(session.audioFile).toBe('audio/meeting.webm');
			expect(session.transcriptFile).toBe('audio/meeting.webm.transcript.json');
		});

		it('sets initial pipeline state to transcribing', () => {
			const session = manager.createSession('audio/meeting.webm');

			expect(session.pipeline.status).toBe('transcribing');
			expect(session.pipeline.progress).toBe(0);
			expect(session.pipeline.completedSteps).toEqual([]);
		});

		it('sets createdAt and updatedAt as ISO timestamps', () => {
			const session = manager.createSession('audio/meeting.webm');

			expect(session.createdAt).toBe('2026-03-24T10:00:00.000Z');
			expect(session.updatedAt).toBe('2026-03-24T10:00:00.000Z');
		});

		it('generates auto title with date and time', () => {
			const session = manager.createSession('audio/meeting.webm');

			expect(session.title).toMatch(/^Meeting 2026-03-24/);
		});

		it('generates unique IDs for different sessions', () => {
			const session1 = manager.createSession('audio/a.webm');
			const session2 = manager.createSession('audio/b.webm');

			expect(session1.id).not.toBe(session2.id);
		});

		it('stores session in internal map (retrievable via getSession)', () => {
			const session = manager.createSession('audio/meeting.webm');
			const retrieved = manager.getSession(session.id);

			expect(retrieved).toBeDefined();
			expect(retrieved!.id).toBe(session.id);
		});

		it('returns a copy, not internal reference', () => {
			const session = manager.createSession('audio/meeting.webm');
			session.title = 'mutated';

			const retrieved = manager.getSession(session.id);
			expect(retrieved!.title).not.toBe('mutated');
		});
	});

	describe('getSession', () => {
		it('returns undefined for unknown ID', () => {
			expect(manager.getSession('nonexistent')).toBeUndefined();
		});

		it('returns a copy that does not affect internal state', () => {
			const session = manager.createSession('audio/meeting.webm');
			const copy = manager.getSession(session.id)!;
			copy.pipeline.status = 'error';
			copy.title = 'changed';

			const fresh = manager.getSession(session.id)!;
			expect(fresh.pipeline.status).toBe('transcribing');
			expect(fresh.title).not.toBe('changed');
		});

		it('returns a deep copy of completedSteps array', () => {
			const session = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(session.id, { completedSteps: ['transcribe'] });

			const copy = manager.getSession(session.id)!;
			copy.pipeline.completedSteps.push('summarize');

			const fresh = manager.getSession(session.id)!;
			expect(fresh.pipeline.completedSteps).toEqual(['transcribe']);
		});
	});

	describe('getAllSessions', () => {
		it('returns empty array when no sessions exist', () => {
			expect(manager.getAllSessions()).toEqual([]);
		});

		it('returns sessions ordered by createdAt descending (newest first)', () => {
			vi.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));
			const first = manager.createSession('audio/a.webm');

			vi.setSystemTime(new Date('2026-03-24T11:00:00.000Z'));
			const second = manager.createSession('audio/b.webm');

			vi.setSystemTime(new Date('2026-03-24T12:00:00.000Z'));
			const third = manager.createSession('audio/c.webm');

			const all = manager.getAllSessions();
			expect(all).toHaveLength(3);
			expect(all[0]!.id).toBe(third.id);
			expect(all[1]!.id).toBe(second.id);
			expect(all[2]!.id).toBe(first.id);
		});

		it('returns copies, not internal references', () => {
			manager.createSession('audio/meeting.webm');
			const all = manager.getAllSessions();
			all[0]!.pipeline.status = 'error';

			const fresh = manager.getAllSessions();
			expect(fresh[0]!.pipeline.status).toBe('transcribing');
		});
	});

	describe('getActiveSessions', () => {
		it('returns only sessions with active statuses', () => {
			const s1 = manager.createSession('audio/a.webm');
			const s2 = manager.createSession('audio/b.webm');
			const s3 = manager.createSession('audio/c.webm');
			const s4 = manager.createSession('audio/d.webm');

			// s1: transcribing (active by default)
			// s2: complete (not active)
			manager.updateSessionState(s2.id, { status: 'complete', progress: 100 });
			// s3: error (not active)
			manager.updateSessionState(s3.id, { status: 'error', error: 'fail' });
			// s4: recording (active)
			manager.updateSessionState(s4.id, { status: 'recording' });

			const active = manager.getActiveSessions();
			expect(active).toHaveLength(2);
			const activeIds = active.map(s => s.id);
			expect(activeIds).toContain(s1.id);
			expect(activeIds).toContain(s4.id);
		});

		it('includes summarizing status as active', () => {
			const s = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(s.id, { status: 'summarizing' });

			const active = manager.getActiveSessions();
			expect(active).toHaveLength(1);
			expect(active[0]!.pipeline.status).toBe('summarizing');
		});

		it('returns empty array when all sessions are complete or error', () => {
			const s1 = manager.createSession('audio/a.webm');
			const s2 = manager.createSession('audio/b.webm');
			manager.updateSessionState(s1.id, { status: 'complete' });
			manager.updateSessionState(s2.id, { status: 'error' });

			expect(manager.getActiveSessions()).toEqual([]);
		});
	});

	describe('updateSessionState', () => {
		it('merges patch into pipeline state', () => {
			const session = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(session.id, { status: 'summarizing', progress: 75 });

			const updated = manager.getSession(session.id)!;
			expect(updated.pipeline.status).toBe('summarizing');
			expect(updated.pipeline.progress).toBe(75);
			// completedSteps preserved from initial state
			expect(updated.pipeline.completedSteps).toEqual([]);
		});

		it('preserves unpatched pipeline fields', () => {
			const session = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(session.id, {
				completedSteps: ['transcribe'],
			});

			const updated = manager.getSession(session.id)!;
			expect(updated.pipeline.status).toBe('transcribing');
			expect(updated.pipeline.completedSteps).toEqual(['transcribe']);
		});

		it('updates updatedAt timestamp', () => {
			const session = manager.createSession('audio/meeting.webm');
			const originalUpdatedAt = session.updatedAt;

			vi.setSystemTime(new Date('2026-03-24T11:00:00.000Z'));
			manager.updateSessionState(session.id, { progress: 50 });

			const updated = manager.getSession(session.id)!;
			expect(updated.updatedAt).not.toBe(originalUpdatedAt);
			expect(updated.updatedAt).toBe('2026-03-24T11:00:00.000Z');
		});

		it('throws DataError for unknown session ID', () => {
			expect(() => {
				manager.updateSessionState('nonexistent', { status: 'complete' });
			}).toThrow(DataError);
		});
	});

	describe('subscribe / unsubscribe', () => {
		it('observer receives notification on createSession', () => {
			const observer = vi.fn();
			manager.subscribe(observer);

			const session = manager.createSession('audio/meeting.webm');

			expect(observer).toHaveBeenCalledTimes(1);
			expect(observer).toHaveBeenCalledWith(session.id, expect.objectContaining({
				id: session.id,
				audioFile: 'audio/meeting.webm',
			}));
		});

		it('observer receives notification on updateSessionState', () => {
			const observer = vi.fn();
			const session = manager.createSession('audio/meeting.webm');
			manager.subscribe(observer);

			manager.updateSessionState(session.id, { status: 'complete', progress: 100 });

			expect(observer).toHaveBeenCalledTimes(1);
			expect(observer).toHaveBeenCalledWith(session.id, expect.objectContaining({
				pipeline: expect.objectContaining({ status: 'complete' }),
			}));
		});

		it('multiple observers all receive notifications', () => {
			const observer1 = vi.fn();
			const observer2 = vi.fn();
			manager.subscribe(observer1);
			manager.subscribe(observer2);

			manager.createSession('audio/meeting.webm');

			expect(observer1).toHaveBeenCalledTimes(1);
			expect(observer2).toHaveBeenCalledTimes(1);
		});

		it('unsubscribed observer stops receiving notifications', () => {
			const observer = vi.fn();
			manager.subscribe(observer);

			manager.createSession('audio/a.webm');
			expect(observer).toHaveBeenCalledTimes(1);

			manager.unsubscribe(observer);
			manager.createSession('audio/b.webm');
			expect(observer).toHaveBeenCalledTimes(1); // still 1, not called again
		});

		it('observer receives a copy, not internal reference', () => {
			let received: MeetingSession | null = null;
			manager.subscribe((_id, session) => {
				received = session;
			});

			const created = manager.createSession('audio/meeting.webm');
			expect(received).not.toBeNull();
			received!.pipeline.status = 'error';

			const fresh = manager.getSession(created.id)!;
			expect(fresh.pipeline.status).toBe('transcribing');
		});
	});

	describe('observer error isolation', () => {
		it('one observer throwing does not prevent others from being called', () => {
			const badObserver = vi.fn(() => {
				throw new Error('Observer crashed');
			});
			const goodObserver = vi.fn();

			manager.subscribe(badObserver);
			manager.subscribe(goodObserver);

			manager.createSession('audio/meeting.webm');

			expect(badObserver).toHaveBeenCalledTimes(1);
			expect(goodObserver).toHaveBeenCalledTimes(1);
		});

		it('logs error when observer throws', () => {
			const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
			manager.subscribe(() => {
				throw new Error('Observer failed');
			});

			manager.createSession('audio/meeting.webm');

			expect(errorSpy).toHaveBeenCalledWith(
				'SessionManager',
				'Observer error',
				expect.objectContaining({ error: 'Observer failed' }),
			);
		});
	});

	describe('reset', () => {
		it('clears all sessions', () => {
			manager.createSession('audio/a.webm');
			manager.createSession('audio/b.webm');
			expect(manager.getAllSessions()).toHaveLength(2);

			manager.reset();
			expect(manager.getAllSessions()).toEqual([]);
		});

		it('clears all observers', () => {
			const observer = vi.fn();
			manager.subscribe(observer);
			manager.reset();

			manager.createSession('audio/meeting.webm');
			expect(observer).not.toHaveBeenCalled();
		});
	});

	describe('findSessionByNotePath', () => {
		it('returns session when noteFilePath matches', () => {
			const session = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(session.id, {
				status: 'complete',
				noteFilePath: 'Meeting Notes/Meeting 2026-03-24.md',
			});

			const found = manager.findSessionByNotePath('Meeting Notes/Meeting 2026-03-24.md');
			expect(found).toBeDefined();
			expect(found!.id).toBe(session.id);
			expect(found!.pipeline.noteFilePath).toBe('Meeting Notes/Meeting 2026-03-24.md');
		});

		it('returns undefined when no session matches', () => {
			manager.createSession('audio/meeting.webm');
			const found = manager.findSessionByNotePath('Meeting Notes/nonexistent.md');
			expect(found).toBeUndefined();
		});

		it('returns undefined when no sessions exist', () => {
			const found = manager.findSessionByNotePath('Meeting Notes/some.md');
			expect(found).toBeUndefined();
		});

		it('returns a defensive copy', () => {
			const session = manager.createSession('audio/meeting.webm');
			manager.updateSessionState(session.id, {
				status: 'complete',
				noteFilePath: 'Meeting Notes/Meeting.md',
			});

			const found = manager.findSessionByNotePath('Meeting Notes/Meeting.md')!;
			found.pipeline.completedSteps.push('hacked');
			found.title = 'mutated';

			const refetched = manager.findSessionByNotePath('Meeting Notes/Meeting.md')!;
			expect(refetched.pipeline.completedSteps).toEqual([]);
			expect(refetched.title).not.toBe('mutated');
		});

		it('finds first matching session when multiple sessions exist', () => {
			const session1 = manager.createSession('audio/meeting1.webm');
			const session2 = manager.createSession('audio/meeting2.webm');
			manager.updateSessionState(session1.id, {
				status: 'complete',
				noteFilePath: 'Meeting Notes/Meeting 1.md',
			});
			manager.updateSessionState(session2.id, {
				status: 'complete',
				noteFilePath: 'Meeting Notes/Meeting 2.md',
			});

			const found = manager.findSessionByNotePath('Meeting Notes/Meeting 2.md');
			expect(found).toBeDefined();
			expect(found!.id).toBe(session2.id);
		});
	});
});
