import type { SummaryResult, TranscriptionResult, MeetingMetadata, ParticipantAlias } from '../providers/types';
import { buildFrontmatter } from './frontmatter-builder';
import { formatTranscriptSection } from './templates';

export interface NoteInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
	includeTranscript?: boolean;
	transcriptLink?: string;
	participants?: ParticipantAlias[];
}

export interface TranscriptNoteInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
	meetingNoteLink: string;
	participants?: ParticipantAlias[];
}

export function extractParticipants(transcriptionResult: TranscriptionResult): ParticipantAlias[] {
	const seen = new Set<string>();
	const result: ParticipantAlias[] = [];
	for (const segment of transcriptionResult.segments) {
		const speaker = segment.speaker?.trim();
		if (speaker && !seen.has(speaker)) {
			seen.add(speaker);
			result.push({ alias: speaker, name: '' });
		}
	}
	return result;
}

export function generateNote(input: NoteInput): string {
	const frontmatter = buildFrontmatter({
		...input,
		transcript: input.transcriptLink,
		participants: input.participants,
	});
	const audioFilename = input.audioFilePath.split('/').pop() ?? input.audioFilePath;
	const audioEmbed = `![[${audioFilename}]]`;
	const body = input.summaryResult.summary;

	if (input.transcriptLink) {
		return `${frontmatter}\n\n${audioEmbed}\n\n${body}\n\n> Full transcript: ${input.transcriptLink}\n`;
	}

	if (input.includeTranscript) {
		const transcript = formatTranscriptSection(input.transcriptionResult);
		return `${frontmatter}\n\n${audioEmbed}\n\n${body}\n\n## Transcript\n\n${transcript}\n`;
	}

	return `${frontmatter}\n\n${audioEmbed}\n\n${body}\n`;
}

export function generateTranscriptNote(input: TranscriptNoteInput): string {
	const frontmatter = buildFrontmatter({
		summaryResult: input.summaryResult,
		transcriptionResult: input.transcriptionResult,
		audioFilePath: input.audioFilePath,
		typeOverride: 'transcript',
		meeting: input.meetingNoteLink,
		participants: input.participants,
	});
	const transcript = formatTranscriptSection(input.transcriptionResult);
	return `${frontmatter}\n\n## Transcript\n\n${transcript}\n`;
}

export interface ParticipantReplacementResult {
	updatedContent: string;
	updatedParticipants: ParticipantAlias[];
	replacementCount: number;
}

export function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return null;
	return { frontmatter: match[1]!, body: match[2]! };
}

export function parseParticipantsFromYaml(frontmatter: string): ParticipantAlias[] | null {
	const participantsMatch = frontmatter.match(/^participants:\s*$/m);
	if (!participantsMatch) return null;

	const participants: ParticipantAlias[] = [];
	const lines = frontmatter.split('\n');
	let inParticipants = false;

	for (const line of lines) {
		if (line.match(/^participants:\s*$/)) {
			inParticipants = true;
			continue;
		}
		if (inParticipants) {
			const aliasMatch = line.match(/^\s+-\s+alias:\s+"(.*)"\s*$/);
			if (aliasMatch) {
				participants.push({ alias: aliasMatch[1]!, name: '' });
				continue;
			}
			const nameMatch = line.match(/^\s+name:\s+"(.*)"\s*$/);
			if (nameMatch && participants.length > 0) {
				participants[participants.length - 1]!.name = nameMatch[1]!;
				continue;
			}
			// If we hit a non-participant line while in participants section, stop
			if (!line.match(/^\s/) || line.match(/^\S/)) {
				inParticipants = false;
			}
		}
	}

	return participants.length > 0 ? participants : null;
}

export function applyParticipantReplacements(content: string, participants: ParticipantAlias[]): ParticipantReplacementResult {
	const parsed = parseFrontmatter(content);
	if (!parsed) {
		return { updatedContent: content, updatedParticipants: participants, replacementCount: 0 };
	}

	let body = parsed.body;
	let replacementCount = 0;
	const updatedParticipants = participants.map(p => ({ ...p }));

	// Sort by alias length descending to prevent prefix collisions
	// (e.g., "Participant 10" must be replaced before "Participant 1")
	updatedParticipants.sort((a, b) => b.alias.length - a.alias.length);

	for (const participant of updatedParticipants) {
		if (!participant.name) continue;

		const newWikiLink = participant.name.startsWith('[[') ? participant.name : `[[${participant.name}]]`;

		// New format: plain text bold speaker label (e.g., **Participant 1:**)
		const plainOld = `**${participant.alias}:**`;
		const plainNew = `**${newWikiLink}:**`;
		if (plainOld !== plainNew) {
			const count = body.split(plainOld).length - 1;
			if (count > 0) {
				body = body.split(plainOld).join(plainNew);
				replacementCount += count;
			}
		}

		// Old format: wiki-link (backward compat for notes from previous versions)
		const wikiOld = `[[${participant.alias}]]`;
		const wikiNew = newWikiLink;
		if (wikiOld !== wikiNew) {
			const count = body.split(wikiOld).length - 1;
			if (count > 0) {
				body = body.split(wikiOld).join(wikiNew);
				replacementCount += count;
			}
		}

		// Standalone plain text in summary/discussion (e.g., "Participant 1 led the meeting")
		const standaloneOld = participant.alias;
		const standaloneNew = newWikiLink;
		if (body.includes(standaloneOld)) {
			const count = body.split(standaloneOld).length - 1;
			if (count > 0) {
				body = body.split(standaloneOld).join(standaloneNew);
				replacementCount += count;
			}
		}

		// Update alias to reflect new display name for idempotent re-runs
		if (participant.name.startsWith('[[')) {
			participant.alias = participant.name.slice(2, -2);
		} else {
			participant.alias = participant.name;
		}
	}

	// Rebuild frontmatter with updated participants
	const frontmatterLines = parsed.frontmatter.split('\n');
	const newFrontmatterLines: string[] = [];
	let inParticipants = false;
	for (const line of frontmatterLines) {
		if (line.match(/^participants:\s*$/)) {
			inParticipants = true;
			newFrontmatterLines.push('participants:');
			for (const p of updatedParticipants) {
				newFrontmatterLines.push(`  - alias: "${p.alias}"`);
				newFrontmatterLines.push(`    name: "${p.name}"`);
			}
			continue;
		}
		if (inParticipants) {
			if (line.match(/^\s+-\s+alias:/) || line.match(/^\s+name:/)) {
				continue; // Skip old participant lines
			}
			if (!line.match(/^\s/) || line.match(/^\S/)) {
				inParticipants = false;
				newFrontmatterLines.push(line);
			}
			continue;
		}
		newFrontmatterLines.push(line);
	}

	const updatedContent = `---\n${newFrontmatterLines.join('\n')}\n---\n${body}`;

	return { updatedContent, updatedParticipants, replacementCount };
}

export function generateFilename(metadata: MeetingMetadata | undefined): string {
	const date = metadata?.date ?? new Date().toISOString().slice(0, 10);
	const title = metadata?.title ?? 'Untitled Meeting';
	const sanitized = title.replace(/[/\\:*?"<>|]/g, '-');
	return `${date} ${sanitized}.md`;
}

export function generateTranscriptFilename(noteFilename: string): string {
	return noteFilename.replace(/\.md$/, ' - Transcript.md');
}
