import type { TranscriptionResult } from '../providers/types';
import type { TranscriptData, TranscriptSegmentV2, ParticipantMapping } from './transcript-data';
import { generateSegmentId } from './transcript-data';

/**
 * Migrate a v1 TranscriptionResult (or raw JSON with version 1) to TranscriptData v2.
 */
export function migrateV1ToV2(v1: Record<string, unknown>): TranscriptData {
	const segments = (v1['segments'] as Array<Record<string, unknown>>) ?? [];
	const audioFile = (v1['audioFile'] as string) ?? '';
	const provider = (v1['provider'] as string) ?? '';
	const model = (v1['model'] as string) ?? '';
	const language = (v1['language'] as string) ?? '';
	const createdAt = (v1['createdAt'] as string) ?? new Date().toISOString();

	// Extract unique speakers in order of appearance
	const speakerSet = new Set<string>();
	for (const seg of segments) {
		const speaker = (seg['speaker'] as string)?.trim();
		if (speaker) {
			speakerSet.add(speaker);
		}
	}
	const speakers = [...speakerSet];

	const v2Segments: TranscriptSegmentV2[] = segments.map(seg => ({
		id: generateSegmentId(),
		speaker: ((seg['speaker'] as string) ?? '').trim(),
		start: (seg['start'] as number) ?? 0,
		end: (seg['end'] as number) ?? 0,
		text: (seg['text'] as string) ?? '',
	}));

	const participants: ParticipantMapping[] = speakers.map((alias, i) => ({
		alias,
		name: '',
		wikiLink: false,
		color: i,
	}));

	const duration = v2Segments.length > 0
		? Math.max(...v2Segments.map(s => s.end))
		: 0;

	return {
		version: 2,
		audioFile,
		duration,
		provider,
		model,
		language,
		segments: v2Segments,
		participants,
		pipeline: {
			status: 'complete',
			progress: 100,
			completedSteps: ['transcribe', 'summarize', 'generate'],
		},
		meetingNote: '',
		createdAt,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Convert a fresh TranscriptionResult (from STT provider) to TranscriptData v2.
 * Used when pipeline creates a new transcript — pipeline status is 'transcribing'.
 */
export function transcriptionResultToV2(result: TranscriptionResult, audioFilePath: string): TranscriptData {
	const speakerSet = new Set<string>();
	for (const seg of result.segments) {
		const speaker = seg.speaker?.trim();
		if (speaker) {
			speakerSet.add(speaker);
		}
	}
	const speakers = [...speakerSet];

	const v2Segments: TranscriptSegmentV2[] = result.segments.map(seg => ({
		id: generateSegmentId(),
		speaker: (seg.speaker ?? '').trim(),
		start: seg.start,
		end: seg.end,
		text: seg.text,
	}));

	const participants: ParticipantMapping[] = speakers.map((alias, i) => ({
		alias,
		name: '',
		wikiLink: false,
		color: i,
	}));

	const duration = v2Segments.length > 0
		? Math.max(...v2Segments.map(s => s.end))
		: 0;

	return {
		version: 2,
		audioFile: audioFilePath,
		duration,
		provider: result.provider,
		model: result.model,
		language: result.language,
		segments: v2Segments,
		participants,
		pipeline: {
			status: 'transcribing',
			progress: 50,
			completedSteps: ['transcribe'],
		},
		meetingNote: '',
		createdAt: result.createdAt,
		updatedAt: new Date().toISOString(),
	};
}
