import type { SummaryResult, TranscriptionResult, ParticipantAlias } from '../providers/types';

export interface FrontmatterInput {
	summaryResult: SummaryResult;
	transcriptionResult: TranscriptionResult;
	audioFilePath: string;
	transcript?: string;
	meeting?: string;
	participants?: ParticipantAlias[];
	transcriptDataPath?: string;
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

export function buildFrontmatter(input: FrontmatterInput): string {
	const { summaryResult, audioFilePath } = input;
	const metadata = summaryResult.metadata;

	const date = metadata?.date ?? new Date().toISOString().slice(0, 10);
	const tags = metadata?.tags ?? ['meeting'];
	const topics = metadata?.topics ?? [];

	const lines: string[] = [
		'---',
		`date: ${date}`,
		yamlArrayField('tags', tags),
		yamlArrayField('topics', topics),
		`audio: ${audioFilePath}`,
	];

	if (input.transcript) {
		lines.push(`transcript: ${yamlString(input.transcript)}`);
	}
	if (input.meeting) {
		lines.push(`meeting: ${yamlString(input.meeting)}`);
	}
	if (input.transcriptDataPath) {
		lines.push(`transcript_data: ${yamlString(input.transcriptDataPath)}`);
	}

	lines.push('---');

	return lines.join('\n');
}
