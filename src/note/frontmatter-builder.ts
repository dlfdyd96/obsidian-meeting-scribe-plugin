import type { SummaryResult, TranscriptionResult } from '../providers/types';

export interface FrontmatterInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
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

export function buildFrontmatter(input: FrontmatterInput): string {
	const { summaryResult, transcriptionResult, audioFilePath } = input;
	const metadata = summaryResult.metadata;

	const date = metadata?.date ?? new Date().toISOString().slice(0, 10);
	const title = metadata?.title ?? 'Untitled Meeting';
	const participants = metadata?.participants ?? [];
	const tags = metadata?.tags ?? ['meeting'];
	const topics = metadata?.topics ?? [];
	const duration = computeDurationMinutes(transcriptionResult);

	const lines: string[] = [
		'---',
		`date: ${date}`,
		'type: meeting',
		`title: ${yamlString(title)}`,
		yamlArrayField('participants', participants),
		yamlArrayField('tags', tags),
		yamlArrayField('topics', topics),
		`duration: ${duration}`,
		`audio: ${audioFilePath}`,
		'created_by: meeting-scribe',
		'---',
	];

	return lines.join('\n');
}
