import type { TranscriptData } from '../../transcript/transcript-data';
import type { TranscriptionResult } from '../../providers/types';

export interface BuildTranscriptionOptions {
	/** Wrap mapped speaker names in [[wiki-link]] when participant.wikiLink is true */
	applyWikiLinks?: boolean;
}

/**
 * Build a TranscriptionResult from TranscriptData, applying participant name mappings
 * to speaker labels. Used for re-summarize and export flows.
 */
export function buildTranscriptionResultFromData(
	data: TranscriptData,
	options?: BuildTranscriptionOptions,
): TranscriptionResult {
	const mappedSegments = data.segments.map(seg => {
		const participant = data.participants.find(p => p.alias === seg.speaker);
		let displayName = (participant?.name) || seg.speaker;
		if (options?.applyWikiLinks && participant?.wikiLink && participant?.name) {
			displayName = `[[${displayName}]]`;
		}
		return { ...seg, speaker: displayName };
	});

	const fullText = mappedSegments.map(s => {
		const speaker = s.speaker.trim();
		return speaker ? `${speaker}: ${s.text}` : s.text;
	}).join('\n');

	return {
		version: 1,
		audioFile: data.audioFile,
		provider: data.provider,
		model: data.model,
		language: data.language,
		segments: mappedSegments,
		fullText,
		createdAt: data.createdAt,
	};
}
