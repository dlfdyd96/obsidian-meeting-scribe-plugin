import type { PipelineStep, PipelineContext } from '../pipeline-types';
import type { SummaryResult, MeetingMetadata } from '../../providers/types';
import { providerRegistry } from '../../providers/provider-registry';
import { ConfigError, DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { getDefaultPreset, buildUserPrompt, buildLanguageInstruction, formatSummaryBody } from '../../note/templates';
import type { LLMNoteOutput } from '../../note/templates';

const COMPONENT = 'SummarizeStep';

function stripCodeFences(text: string): string {
	return text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
}

function tryParseJSON(text: string): LLMNoteOutput | null {
	try {
		return JSON.parse(text) as LLMNoteOutput;
	} catch {
		return null;
	}
}

export class SummarizeStep implements PipelineStep {
	readonly name = 'summarize';

	async execute(context: PipelineContext): Promise<PipelineContext> {
		const { settings } = context;

		// Validate transcription result exists
		if (!context.transcriptionResult) {
			throw new DataError('No transcription result available for summarization');
		}

		// Get LLM provider
		const provider = providerRegistry.getLLMProvider(settings.llmProvider);
		if (!provider) {
			throw new ConfigError(`LLM provider not found: ${settings.llmProvider}`);
		}

		// Validate API key
		if (!settings.llmApiKey) {
			throw new ConfigError('LLM API key is not configured');
		}

		// Set credentials on provider
		provider.setCredentials({ type: 'api-key', apiKey: settings.llmApiKey });

		logger.info(COMPONENT, 'Starting summarization', {
			provider: settings.llmProvider,
			transcriptLength: context.transcriptionResult.fullText.length,
		});

		// Build prompts from default preset
		const preset = getDefaultPreset();
		const languageInstruction = buildLanguageInstruction(settings.summaryLanguage);
		const systemPrompt = preset.systemPrompt + languageInstruction;
		const userPrompt = buildUserPrompt(
			preset.userPromptTemplate,
			context.transcriptionResult.fullText,
		);

		// Call LLM provider
		const result = await provider.summarize(systemPrompt, userPrompt);

		// Report progress
		context.onProgress?.('summarizing', 1, 1);

		// Attempt to parse structured output from the summary field
		const enrichedResult = this.enrichResult(result);

		logger.info(COMPONENT, 'Summarization complete', {
			hasMetadata: enrichedResult.metadata !== undefined,
			summaryLength: enrichedResult.summary.length,
		});

		return { ...context, summaryResult: enrichedResult };
	}

	private enrichResult(result: SummaryResult): SummaryResult {
		// If the provider already extracted metadata and the summary is not raw JSON,
		// return as-is. The provider already did the heavy lifting.
		if (result.metadata && !this.looksLikeJSON(result.summary)) {
			return result;
		}

		// Try to parse the summary as structured JSON (LLMNoteOutput)
		const parsed = this.parseStructuredOutput(result.summary);

		if (parsed) {
			const metadata: MeetingMetadata = {
				title: parsed.metadata.title,
				date: parsed.metadata.date ?? undefined,
				participants: parsed.metadata.participants,
				topics: parsed.metadata.topics,
				tags: parsed.metadata.tags,
			};

			return {
				...result,
				summary: formatSummaryBody(parsed),
				metadata,
			};
		}

		// Fallback: keep raw summary and provider metadata
		logger.warn(COMPONENT, 'Could not parse structured output from LLM response, using raw summary');
		return result;
	}

	private looksLikeJSON(text: string): boolean {
		const trimmed = text.trim();
		return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			trimmed.startsWith('```');
	}

	private parseStructuredOutput(text: string): LLMNoteOutput | null {
		// Tier 1: Direct JSON parse
		const direct = tryParseJSON(text);
		if (direct) return direct;

		// Tier 2: Strip code fences and retry
		const stripped = stripCodeFences(text.trim());
		const afterStrip = tryParseJSON(stripped);
		if (afterStrip) return afterStrip;

		// Tier 3: Fallback - return null
		return null;
	}
}
