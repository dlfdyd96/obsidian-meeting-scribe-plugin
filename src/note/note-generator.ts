import type { SummaryResult, TranscriptionResult, MeetingMetadata } from '../providers/types';
import { buildFrontmatter } from './frontmatter-builder';
import { formatTranscriptSection } from './templates';

export interface NoteInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
	includeTranscript?: boolean;
}

export function generateNote(input: NoteInput): string {
	const frontmatter = buildFrontmatter(input);
	const body = input.summaryResult.summary;

	if (input.includeTranscript) {
		const transcript = formatTranscriptSection(input.transcriptionResult);
		return `${frontmatter}\n\n${body}\n\n## Transcript\n\n${transcript}\n`;
	}

	return `${frontmatter}\n\n${body}\n`;
}

export function generateFilename(metadata: MeetingMetadata | undefined): string {
	const date = metadata?.date ?? new Date().toISOString().slice(0, 10);
	const title = metadata?.title ?? 'Untitled Meeting';
	const sanitized = title.replace(/[/\\:*?"<>|]/g, '-');
	return `${date} ${sanitized}.md`;
}
