import type { PipelineState } from '../transcript/transcript-data';

export interface MeetingSession {
	id: string;
	title: string;
	audioFile: string;
	transcriptFile: string;
	pipeline: PipelineState;
	createdAt: string;
	updatedAt: string;
}

export type SessionObserver = (sessionId: string, session: MeetingSession) => void;
