import { requestUrl } from 'obsidian';

import { OpenAILLMProvider } from '../../../src/providers/llm/openai-llm-provider';
import { classifyOpenAIError } from '../../../src/providers/openai-error-utils';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';
import {
	createChatCompletionResponse,
	createChatCompletionWithFinishReason,
	createChatCompletionWithContent,
} from '../../fixtures/openai-llm-responses';
import { createRequestUrlSuccess, createRequestUrlError } from '../../fixtures/openai-responses';

describe('OpenAILLMProvider', () => {
	let provider: OpenAILLMProvider;

	beforeEach(() => {
		provider = new OpenAILLMProvider();
		provider.setCredentials({ type: 'api-key', apiKey: 'test-api-key' });
		vi.clearAllMocks();
	});

	describe('getSupportedModels', () => {
		it('should return 4 models', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(4);
			expect(models.map((m) => m.id)).toEqual([
				'gpt-4o-mini',
				'gpt-4o',
				'gpt-4.1-mini',
				'gpt-4.1',
			]);
		});

		it('should return a defensive copy', () => {
			const models1 = provider.getSupportedModels();
			const models2 = provider.getSupportedModels();
			expect(models1).not.toBe(models2);
			expect(models1).toEqual(models2);
		});
	});

	describe('summarize', () => {
		it('should send correct Chat Completions request', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			await provider.summarize('You are a summarizer.', 'Meeting transcript here.');

			expect(requestUrl).toHaveBeenCalledWith({
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				headers: {
					'Authorization': 'Bearer test-api-key',
					'Content-Type': 'application/json',
				},
				body: expect.any(String),
			});

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.messages).toEqual([
				{ role: 'system', content: 'You are a summarizer.' },
				{ role: 'user', content: 'Meeting transcript here.' },
			]);
		});

		it('should use JSON mode response format', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			await provider.summarize('system', 'user');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.response_format).toEqual({ type: 'json_object' });
		});

		it('should set temperature to 0.3', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			await provider.summarize('system', 'user');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.temperature).toBe(0.3);
		});

		it('should set max_completion_tokens to 4096', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			await provider.summarize('system', 'user');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.max_completion_tokens).toBe(4096);
		});

		it('should parse JSON response into SummaryResult', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.version).toBe(1);
			expect(result.provider).toBe('openai');
			expect(result.model).toBe('gpt-4o-mini-2024-07-18');
			expect(result.summary).toBe('This meeting covered project updates and next steps.');
			expect(result.createdAt).toBeDefined();
		});

		it('should extract metadata from parsed JSON', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionResponse()),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.metadata).toEqual({
				date: '2026-03-16',
				title: 'Weekly Standup',
				participants: ['Alice', 'Bob'],
				topics: ['project updates', 'next steps'],
				tags: ['standup', 'weekly'],
			});
		});

		it('should handle missing metadata gracefully', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(
					createChatCompletionWithContent(JSON.stringify({ summary: 'No metadata here.' })),
				),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.summary).toBe('No metadata here.');
			expect(result.metadata).toBeUndefined();
		});

		it('should handle non-JSON response as raw summary', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(
					createChatCompletionWithContent('This is plain text, not JSON.'),
				),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.summary).toBe('This is plain text, not JSON.');
			expect(result.metadata).toBeUndefined();
		});

		it('should warn on finish_reason length', async () => {
			const { logger } = await import('../../../src/utils/logger');
			const warnSpy = vi.spyOn(logger, 'warn');

			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionWithFinishReason('length')),
			);

			await provider.summarize('system', 'user');

			expect(warnSpy).toHaveBeenCalledWith(
				'OpenAILLMProvider',
				'Response may be truncated — max_completion_tokens reached',
			);
		});

		it('should throw DataError on finish_reason content_filter', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createChatCompletionWithFinishReason('content_filter')),
			);

			await expect(provider.summarize('system', 'user')).rejects.toThrow(DataError);
			await expect(provider.summarize('system', 'user')).rejects.toThrow(
				'Content was flagged by OpenAI safety filter.',
			);
		});
	});

	describe('error handling', () => {
		it('should throw ConfigError on 401', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(401));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(ConfigError);
		});

		it('should throw ConfigError on 403', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(403));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(ConfigError);
		});

		it('should throw DataError on 400', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(400));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(DataError);
		});

		it('should throw TransientError on 429 rate limit', async () => {
			vi.mocked(requestUrl).mockRejectedValue(
				createRequestUrlError(429, { error: { message: 'Rate limit exceeded' } }),
			);

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw ConfigError on 429 quota', async () => {
			vi.mocked(requestUrl).mockRejectedValue(
				createRequestUrlError(429, { error: { message: 'insufficient_quota' } }),
			);

			await expect(provider.summarize('system', 'user')).rejects.toThrow(ConfigError);
		});

		it('should throw TransientError on 500', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(500));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on 503', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(503));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on network error', async () => {
			vi.mocked(requestUrl).mockRejectedValue(new Error('Network failure'));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});
	});

	describe('validateApiKey', () => {
		it('should return true for valid key', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess({ data: [] }),
			);

			const result = await provider.validateApiKey('valid-key');
			expect(result).toBe(true);

			expect(requestUrl).toHaveBeenCalledWith({
				url: 'https://api.openai.com/v1/models',
				method: 'GET',
				headers: {
					'Authorization': 'Bearer valid-key',
				},
			});
		});

		it('should return false for invalid key', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(401));

			const result = await provider.validateApiKey('invalid-key');
			expect(result).toBe(false);
		});
	});
});

describe('classifyOpenAIError', () => {
	it('should throw ConfigError for 401', () => {
		expect(() => classifyOpenAIError({ status: 401, json: {} })).toThrow(ConfigError);
	});

	it('should throw ConfigError for 403', () => {
		expect(() => classifyOpenAIError({ status: 403, json: {} })).toThrow(ConfigError);
	});

	it('should throw DataError for 400', () => {
		expect(() => classifyOpenAIError({ status: 400, json: {} })).toThrow(DataError);
	});

	it('should throw DataError for 413', () => {
		expect(() => classifyOpenAIError({ status: 413, json: {} })).toThrow(DataError);
	});

	it('should throw TransientError for 429 rate limit', () => {
		expect(() =>
			classifyOpenAIError({ status: 429, json: { error: { message: 'Rate limit' } } }),
		).toThrow(TransientError);
	});

	it('should throw ConfigError for 429 quota', () => {
		expect(() =>
			classifyOpenAIError({ status: 429, json: { error: { message: 'insufficient_quota' } } }),
		).toThrow(ConfigError);
	});

	it('should throw ConfigError for 429 billing', () => {
		expect(() =>
			classifyOpenAIError({ status: 429, json: { error: { message: 'billing issue' } } }),
		).toThrow(ConfigError);
	});

	it('should throw TransientError for 500', () => {
		expect(() => classifyOpenAIError({ status: 500, json: {} })).toThrow(TransientError);
	});

	it('should throw TransientError for 503', () => {
		expect(() => classifyOpenAIError({ status: 503, json: {} })).toThrow(TransientError);
	});

	it('should throw TransientError for network error', () => {
		expect(() => classifyOpenAIError(new Error('Network failure'))).toThrow(TransientError);
	});
});
