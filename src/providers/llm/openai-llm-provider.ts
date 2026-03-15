import { requestUrl } from 'obsidian';

import { classifyOpenAIError } from '../openai-error-utils';
import { logger } from '../../utils/logger';
import { DataError } from '../../utils/errors';
import type { LLMProvider, LLMModel, SummaryResult, MeetingMetadata } from '../types';

const COMPONENT = 'OpenAILLMProvider';
const API_BASE = 'https://api.openai.com/v1';
const CHAT_COMPLETIONS_ENDPOINT = `${API_BASE}/chat/completions`;
const MODELS_ENDPOINT = `${API_BASE}/models`;

const SUPPORTED_MODELS: LLMModel[] = [
	{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
	{ id: 'gpt-4o', name: 'GPT-4o' },
	{ id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
	{ id: 'gpt-4.1', name: 'GPT-4.1' },
];

export class OpenAILLMProvider implements LLMProvider {
	readonly name = 'openai';
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
				url: CHAT_COMPLETIONS_ENDPOINT,
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: SUPPORTED_MODELS[0]?.id ?? 'gpt-4o-mini',
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt },
					],
					temperature: 0.3,
					max_completion_tokens: 4096,
					response_format: { type: 'json_object' },
				}),
			});

			const data = response.json as {
				model?: string;
				choices?: {
					message?: { content?: string };
					finish_reason?: string;
				}[];
				usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
			};

			const choice = data.choices?.[0];
			const finishReason = choice?.finish_reason;
			const content = choice?.message?.content ?? '';
			const model = data.model ?? SUPPORTED_MODELS[0]?.id ?? 'gpt-4o-mini';

			if (finishReason === 'content_filter') {
				throw new DataError('Content was flagged by OpenAI safety filter.');
			}
			if (finishReason === 'length') {
				logger.warn(COMPONENT, 'Response may be truncated — max_completion_tokens reached');
			}

			let summary = '';
			let metadata: MeetingMetadata | undefined;

			try {
				const parsed = JSON.parse(content) as {
					summary?: string;
					metadata?: {
						date?: string;
						title?: string;
						participants?: string[];
						topics?: string[];
						tags?: string[];
					};
				};
				summary = parsed.summary ?? content;
				if (parsed.metadata) {
					metadata = {
						date: parsed.metadata.date,
						title: parsed.metadata.title,
						participants: parsed.metadata.participants,
						topics: parsed.metadata.topics,
						tags: parsed.metadata.tags,
					};
				}
			} catch {
				logger.warn(COMPONENT, 'Failed to parse JSON response, using raw content');
				summary = content;
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
			if (err instanceof DataError) {
				throw err;
			}
			logger.error(COMPONENT, 'Summarization failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			classifyOpenAIError(err);
		}
	}

	async validateApiKey(key: string): Promise<boolean> {
		logger.debug(COMPONENT, 'Validating API key');
		try {
			await requestUrl({
				url: MODELS_ENDPOINT,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${key}`,
				},
			});
			return true;
		} catch {
			return false;
		}
	}
}
