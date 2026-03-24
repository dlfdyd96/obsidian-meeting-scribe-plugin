import type { Vault } from 'obsidian';
import { logger } from '../utils/logger';

const COMPONENT = 'TranscriptData';

// ===== Types =====

export interface TranscriptSegmentV2 {
	id: string;
	speaker: string;
	start: number;
	end: number;
	text: string;
}

export interface ParticipantMapping {
	alias: string;
	name: string;
	wikiLink: boolean;
	color: number;
}

export interface PipelineState {
	status: 'queued' | 'recording' | 'transcribing' | 'summarizing' | 'complete' | 'error';
	progress: number;
	error?: string;
	failedStep?: string;
	completedSteps: string[];
	noteFilePath?: string;
}

export interface TranscriptData {
	version: 2;
	audioFile: string;
	duration: number;
	provider: string;
	model: string;
	language: string;
	segments: TranscriptSegmentV2[];
	participants: ParticipantMapping[];
	pipeline: PipelineState;
	meetingNote: string;
	createdAt: string;
	updatedAt: string;
}

// ===== Utilities =====

export function generateSegmentId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// ===== I/O =====

export async function loadTranscriptData(vault: Vault, path: string): Promise<TranscriptData | null> {
	try {
		const exists = await vault.adapter.exists(path);
		if (!exists) {
			return null;
		}
		const raw = await vault.adapter.read(path);
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) {
			return null;
		}

		const record = parsed as Record<string, unknown>;

		// Auto-migrate v1 → v2
		if (!record['version'] || record['version'] === 1) {
			const { migrateV1ToV2 } = await import('./transcript-migration');
			const migrated = migrateV1ToV2(record);
			await saveTranscriptData(vault, path, migrated);
			logger.debug(COMPONENT, 'Migrated transcript v1 → v2', { path });
			return migrated;
		}

		// Lightweight v2 shape check
		if (record['version'] !== 2 || !Array.isArray(record['segments'])) {
			return null;
		}

		return parsed as TranscriptData;
	} catch (err) {
		logger.error(COMPONENT, 'Failed to load transcript data', {
			path,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

export async function saveTranscriptData(vault: Vault, path: string, data: TranscriptData): Promise<void> {
	const toWrite = { ...data, updatedAt: new Date().toISOString() };
	await vault.adapter.write(path, JSON.stringify(toWrite, null, 2));
}
