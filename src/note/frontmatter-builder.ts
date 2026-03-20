import type { SummaryResult, TranscriptionResult, ParticipantAlias } from '../providers/types';

export interface FrontmatterInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
	transcript?: string;
	meeting?: string;
	typeOverride?: string;
	participants?: ParticipantAlias[];
}

const YAML_SPECIAL_CHARS = /[:{}&*?|<>!%@#`[\]]/;

function yamlString(value: string): string {
	if (YAML_SPECIAL_CHARS.test(value)) {
		return `'${value.replace(/'/g, "''")}'`;
	}
	return value;
}

function yamlArrayField(key: string, items: string[]): string {
	if (items.length === 0) {
		return `${key}: []`;
	}
	return `${key}:\n` + items.map(item => `  - ${yamlString(item)}`).join('\n');
}

function computeDurationMinutes(transcriptionResult: TranscriptionResult): number {
	const segments = transcriptionResult.segments;
	if (segments.length === 0) {
		return 0;
	}
	const lastSegment = segments[segments.length - 1]!;
	return Math.round(lastSegment.end / 60);
}

function formatParticipants(aliases?: ParticipantAlias[], fallback?: string[]): string {
	if (aliases) {
		if (aliases.length === 0) {
			return 'participants: []';
		}
		const lines = ['participants:'];
		for (const p of aliases) {
			lines.push(`  - alias: "${p.alias}"`);
			lines.push(`    name: "${p.name}"`);
		}
		return lines.join('\n');
	}
	return yamlArrayField('participants', fallback ?? []);
}

export function buildFrontmatter(input: FrontmatterInput): string {
	const { summaryResult, transcriptionResult, audioFilePath } = input;
	const metadata = summaryResult.metadata;

	const date = metadata?.date ?? new Date().toISOString().slice(0, 10);
	const title = metadata?.title ?? 'Untitled Meeting';
	const tags = metadata?.tags ?? ['meeting'];
	const topics = metadata?.topics ?? [];
	const duration = computeDurationMinutes(transcriptionResult);

	const type = input.typeOverride ?? 'meeting';

	const lines: string[] = [
		'---',
		`date: ${date}`,
		`type: ${type}`,
		`title: ${yamlString(title)}`,
		formatParticipants(input.participants, metadata?.participants),
		yamlArrayField('tags', tags),
		yamlArrayField('topics', topics),
		`duration: ${duration}`,
		`audio: ${audioFilePath}`,
	];

	if (input.transcript) {
		lines.push(`transcript: ${yamlString(input.transcript)}`);
	}
	if (input.meeting) {
		lines.push(`meeting: ${yamlString(input.meeting)}`);
	}

	lines.push('created_by: meeting-scribe');
	lines.push('---');

	return lines.join('\n');
}
