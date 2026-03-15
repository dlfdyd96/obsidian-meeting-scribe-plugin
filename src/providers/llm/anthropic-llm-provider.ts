import { requestUrl } from 'obsidian';

import { classifyAnthropicError } from '../anthropic-error-utils';
import { logger } from '../../utils/logger';
import type { LLMProvider, LLMModel, SummaryResult, MeetingMetadata } from '../types';

interface ParsedSummaryResponse {
	summary?: string;
	metadata?: {
		date?: string;
		title?: string;
		participants?: string[];
		topics?: string[];
		tags?: string[];
	};
}

function extractSummaryAndMetadata(
	parsed: ParsedSummaryResponse,
	fallbackSummary: string,
): { summary: string; metadata?: MeetingMetadata } {
	const summary = parsed.summary ?? fallbackSummary;
	let metadata: MeetingMetadata | undefined;
	if (parsed.metadata) {
		metadata = {
			date: parsed.metadata.date,
			title: parsed.metadata.title,
			participants: parsed.metadata.participants,
			topics: parsed.metadata.topics,
			tags: parsed.metadata.tags,
		};
	}
	return { summary, metadata };
}

const COMPONENT = 'AnthropicLLM';
const API_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${API_BASE}/v1/messages`;
const MODELS_ENDPOINT = `${API_BASE}/v1/models`;
const ANTHROPIC_VERSION = '2023-06-01';

const SUPPORTED_MODELS: LLMModel[] = [
	{ id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5' },
	{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
];

export class AnthropicLLMProvider implements LLMProvider {
	readonly name = 'anthropic';
	private apiKey = '';

	setApiKey(key: string): void {
		this.apiKey = key;
	}

	getSupportedModels(): LLMModel[] {
		return [...SUPPORTED_MODELS];
	}

	async summarize(systemPrompt: string, userPrompt: string): Promise<SummaryResult> {
		logger.debug(COMPONENT, 'Starting summarization', {
			systemPromptLength: systemPrompt.length,
			userPromptLength: userPrompt.length,
		});

		try {
			const response = await requestUrl({
				url: MESSAGES_ENDPOINT,
				method: 'POST',
				headers: {
					'x-api-key': this.apiKey,
					'anthropic-version': ANTHROPIC_VERSION,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					model: SUPPORTED_MODELS[0]?.id ?? 'claude-sonnet-4-5-20250514',
					max_tokens: 4096,
					system: systemPrompt,
					messages: [
						{ role: 'user', content: userPrompt },
					],
				}),
			});

			const data = response.json as {
				model?: string;
				content?: { type?: string; text?: string }[];
				stop_reason?: string;
				usage?: { input_tokens?: number; output_tokens?: number };
			};

			const content = data.content?.[0]?.text ?? '';
			const stopReason = data.stop_reason;
			const model = data.model ?? SUPPORTED_MODELS[0]?.id ?? 'claude-sonnet-4-5-20250514';

			if (stopReason === 'max_tokens') {
				logger.warn(COMPONENT, 'Response may be truncated — max_tokens reached');
			}

			let summary = '';
			let metadata: MeetingMetadata | undefined;

			try {
				const parsed = JSON.parse(content) as ParsedSummaryResponse;
				({ summary, metadata } = extractSummaryAndMetadata(parsed, content));
			} catch {
				// Try stripping markdown code fences and retry
				const stripped = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
				try {
					const parsed = JSON.parse(stripped) as ParsedSummaryResponse;
					({ summary, metadata } = extractSummaryAndMetadata(parsed, stripped));
				} catch {
					logger.warn(COMPONENT, 'Failed to parse JSON response, using raw content');
					summary = content;
				}
			}

			logger.debug(COMPONENT, 'Summarization complete', {
				model,
				summaryLength: summary.length,
				hasMetadata: metadata !== undefined,
			});

			return {
				version: 1,
				provider: this.name,
				model,
				summary,
				metadata,
				createdAt: new Date().toISOString(),
			};
		} catch (err) {
			logger.error(COMPONENT, 'Summarization failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			classifyAnthropicError(err);
		}
	}

	async validateApiKey(key: string): Promise<boolean> {
		logger.debug(COMPONENT, 'Validating API key');
		try {
			await requestUrl({
				url: MODELS_ENDPOINT,
				method: 'GET',
				headers: {
					'x-api-key': key,
					'anthropic-version': ANTHROPIC_VERSION,
				},
			});
			return true;
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 401) {
				return false;
			}
			throw err;
		}
	}
}
