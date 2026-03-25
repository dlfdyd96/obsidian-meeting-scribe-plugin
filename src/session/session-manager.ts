import type { PipelineState } from '../transcript/transcript-data';
import type { MeetingSession, SessionObserver } from './types';
import { DataError } from '../utils/errors';
import { logger } from '../utils/logger';

const COMPONENT = 'SessionManager';

const ACTIVE_STATUSES: PipelineState['status'][] = ['queued', 'recording', 'transcribing', 'summarizing'];

export class SessionManager {
	private sessions: Map<string, MeetingSession> = new Map();
	private observers: Set<SessionObserver> = new Set();

	createSession(audioFile: string): MeetingSession {
		const id = this.generateId();
		const now = new Date().toISOString();

		const session: MeetingSession = {
			id,
			title: this.generateTitle(),
			audioFile,
			transcriptFile: `${audioFile}.transcript.json`,
			pipeline: {
				status: 'transcribing',
				progress: 0,
				completedSteps: [],
			},
			createdAt: now,
			updatedAt: now,
		};

		this.sessions.set(id, session);
		logger.info(COMPONENT, 'Session created', { id, audioFile });
		this.notifyObservers(id, session);

		return this.copySession(session);
	}

	getSession(id: string): MeetingSession | undefined {
		const session = this.sessions.get(id);
		if (!session) return undefined;
		return this.copySession(session);
	}

	getAllSessions(): MeetingSession[] {
		return [...this.sessions.values()]
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map(s => this.copySession(s));
	}

	getActiveSessions(): MeetingSession[] {
		return this.getAllSessions().filter(s => ACTIVE_STATUSES.includes(s.pipeline.status));
	}

	updateSessionState(sessionId: string, patch: Partial<PipelineState>): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new DataError(`Session not found: ${sessionId}`);
		}

		session.pipeline = { ...session.pipeline, ...patch };
		session.updatedAt = new Date().toISOString();

		logger.debug(COMPONENT, 'Session state updated', {
			sessionId,
			status: session.pipeline.status,
			progress: session.pipeline.progress,
		});

		this.notifyObservers(sessionId, session);
	}

	subscribe(observer: SessionObserver): void {
		this.observers.add(observer);
	}

	unsubscribe(observer: SessionObserver): void {
		this.observers.delete(observer);
	}

	restoreSession(params: {
		audioFile: string;
		transcriptFile: string;
		title: string;
		pipeline: PipelineState;
		createdAt: string;
	}): MeetingSession {
		const id = this.generateId();
		const now = new Date().toISOString();

		const session: MeetingSession = {
			id,
			title: params.title,
			audioFile: params.audioFile,
			transcriptFile: params.transcriptFile,
			pipeline: {
				...params.pipeline,
				completedSteps: [...params.pipeline.completedSteps],
			},
			createdAt: params.createdAt,
			updatedAt: now,
		};

		this.sessions.set(id, session);
		logger.info(COMPONENT, 'Session restored', { id, audioFile: params.audioFile, status: params.pipeline.status });
		// Do NOT notify observers — restored sessions should not trigger
		// "Meeting note created" notices or other side effects.
		// Caller is responsible for refreshing UI after batch restore.

		return this.copySession(session);
	}

	updateSessionAudioFile(sessionId: string, audioFile: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new DataError(`Session not found: ${sessionId}`);
		}

		session.audioFile = audioFile;
		session.transcriptFile = `${audioFile}.transcript.json`;
		session.updatedAt = new Date().toISOString();

		logger.debug(COMPONENT, 'Session audio file updated', { sessionId, audioFile });
		this.notifyObservers(sessionId, session);
	}

	findSessionByNotePath(notePath: string): MeetingSession | undefined {
		for (const session of this.sessions.values()) {
			if (session.pipeline.noteFilePath === notePath) {
				return this.copySession(session);
			}
		}
		return undefined;
	}

	reset(): void {
		this.sessions.clear();
		this.observers.clear();
	}

	private copySession(session: MeetingSession): MeetingSession {
		return {
			...session,
			pipeline: {
				...session.pipeline,
				completedSteps: [...session.pipeline.completedSteps],
			},
		};
	}

	private generateId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
	}

	private generateTitle(): string {
		const now = new Date();
		const date = now.toISOString().slice(0, 10);
		const time = now.toTimeString().slice(0, 5);
		return `Meeting ${date} ${time}`;
	}

	private notifyObservers(sessionId: string, session: MeetingSession): void {
		for (const observer of this.observers) {
			try {
				observer(sessionId, this.copySession(session));
			} catch (err) {
				logger.error(COMPONENT, 'Observer error', {
					error: (err as Error).message,
				});
			}
		}
	}
}
