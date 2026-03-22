import { requestUrl } from 'obsidian';

import { AnthropicLLMProvider } from '../../../src/providers/llm/anthropic-llm-provider';
import { classifyAnthropicError } from '../../../src/providers/anthropic-error-utils';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';
import {
	createAnthropicMessageResponse,
	createAnthropicMessageWithStopReason,
	createAnthropicMessageWithContent,
} from '../../fixtures/anthropic-llm-responses';
import { createRequestUrlSuccess, createRequestUrlError } from '../../fixtures/openai-responses';

describe('AnthropicLLMProvider', () => {
	let provider: AnthropicLLMProvider;

	beforeEach(() => {
		provider = new AnthropicLLMProvider();
		provider.setCredentials({ type: 'api-key', apiKey: 'test-api-key' });
		vi.clearAllMocks();
	});

	describe('name', () => {
		it('should be anthropic', () => {
			expect(provider.name).toBe('anthropic');
		});
	});

	describe('getSupportedModels', () => {
		it('should return 2 models', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(2);
			expect(models.map((m) => m.id)).toEqual([
				'claude-sonnet-4-5-20250514',
				'claude-haiku-4-5-20251001',
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
		it('should send correct Anthropic Messages API request', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
			);

			await provider.summarize('You are a summarizer.', 'Meeting transcript here.');

			expect(requestUrl).toHaveBeenCalledWith({
				url: 'https://api.anthropic.com/v1/messages',
				method: 'POST',
				headers: {
					'x-api-key': 'test-api-key',
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json',
				},
				body: expect.any(String),
			});
		});

		it('should use system prompt as top-level field, not in messages', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
			);

			await provider.summarize('You are a summarizer.', 'Meeting transcript here.');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.system).toBe('You are a summarizer.');
			expect(body.messages).toEqual([
				{ role: 'user', content: 'Meeting transcript here.' },
			]);
		});

		it('should include mandatory max_tokens', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
			);

			await provider.summarize('system', 'user');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			const body = JSON.parse((callArgs as { body: string }).body);
			expect(body.max_tokens).toBe(4096);
		});

		it('should include anthropic-version header', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
			);

			await provider.summarize('system', 'user');

			const callArgs = vi.mocked(requestUrl).mock.calls[0]?.[0];
			expect((callArgs as { headers: Record<string, string> }).headers['anthropic-version']).toBe('2023-06-01');
		});

		it('should parse JSON response into SummaryResult', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.version).toBe(1);
			expect(result.provider).toBe('anthropic');
			expect(result.model).toBe('claude-sonnet-4-5-20250514');
			expect(result.summary).toBe('This meeting covered project updates and next steps.');
			expect(result.createdAt).toBeDefined();
		});

		it('should extract metadata from parsed JSON', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageResponse()),
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
					createAnthropicMessageWithContent(JSON.stringify({ summary: 'No metadata here.' })),
				),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.summary).toBe('No metadata here.');
			expect(result.metadata).toBeUndefined();
		});

		it('should handle non-JSON response as raw summary', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(
					createAnthropicMessageWithContent('This is plain text, not JSON.'),
				),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.summary).toBe('This is plain text, not JSON.');
			expect(result.metadata).toBeUndefined();
		});

		it('should strip markdown code fences and parse JSON', async () => {
			const jsonContent = JSON.stringify({ summary: 'Parsed from fenced block.', metadata: { title: 'Test' } });
			const fencedContent = '```json\n' + jsonContent + '\n```';

			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(
					createAnthropicMessageWithContent(fencedContent),
				),
			);

			const result = await provider.summarize('system', 'user');

			expect(result.summary).toBe('Parsed from fenced block.');
			expect(result.metadata?.title).toBe('Test');
		});

		it('should warn on stop_reason max_tokens', async () => {
			const { logger } = await import('../../../src/utils/logger');
			const warnSpy = vi.spyOn(logger, 'warn');

			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageWithStopReason('max_tokens')),
			);

			await provider.summarize('system', 'user');

			expect(warnSpy).toHaveBeenCalledWith(
				'AnthropicLLM',
				'Response may be truncated — max_tokens reached',
			);
		});

		it('should not warn on stop_reason end_turn', async () => {
			const { logger } = await import('../../../src/utils/logger');
			const warnSpy = vi.spyOn(logger, 'warn');

			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess(createAnthropicMessageWithStopReason('end_turn')),
			);

			await provider.summarize('system', 'user');

			expect(warnSpy).not.toHaveBeenCalledWith(
				'AnthropicLLM',
				expect.stringContaining('truncated'),
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

		it('should throw TransientError on 429 (always rate limit)', async () => {
			vi.mocked(requestUrl).mockRejectedValue(
				createRequestUrlError(429, { error: { message: 'Rate limit exceeded' } }),
			);

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on 500', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(500));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on 503', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(503));

			await expect(provider.summarize('system', 'user')).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on 529 (Anthropic overload)', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(529));

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
				url: 'https://api.anthropic.com/v1/models',
				method: 'GET',
				headers: {
					'x-api-key': 'valid-key',
					'anthropic-version': '2023-06-01',
				},
			});
		});

		it('should return false for invalid key (401)', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(401));

			const result = await provider.validateApiKey('invalid-key');
			expect(result).toBe(false);
		});

		it('should rethrow non-401 errors', async () => {
			vi.mocked(requestUrl).mockRejectedValue(createRequestUrlError(500));

			await expect(provider.validateApiKey('some-key')).rejects.toThrow();
		});
	});
});

describe('classifyAnthropicError', () => {
	it('should throw ConfigError for 401', () => {
		expect(() => classifyAnthropicError({ status: 401, json: {} })).toThrow(ConfigError);
	});

	it('should throw ConfigError for 403', () => {
		expect(() => classifyAnthropicError({ status: 403, json: {} })).toThrow(ConfigError);
	});

	it('should throw DataError for 400', () => {
		expect(() => classifyAnthropicError({ status: 400, json: {} })).toThrow(DataError);
	});

	it('should throw TransientError for 429 (always rate limit)', () => {
		expect(() =>
			classifyAnthropicError({ status: 429, json: { error: { message: 'Rate limit' } } }),
		).toThrow(TransientError);
	});

	it('should throw TransientError for 429 even with quota message', () => {
		expect(() =>
			classifyAnthropicError({ status: 429, json: { error: { message: 'insufficient_quota' } } }),
		).toThrow(TransientError);
	});

	it('should throw TransientError for 500', () => {
		expect(() => classifyAnthropicError({ status: 500, json: {} })).toThrow(TransientError);
	});

	it('should throw TransientError for 503', () => {
		expect(() => classifyAnthropicError({ status: 503, json: {} })).toThrow(TransientError);
	});

	it('should throw TransientError for 529 (Anthropic overload)', () => {
		expect(() => classifyAnthropicError({ status: 529, json: {} })).toThrow(TransientError);
	});

	it('should throw TransientError for network error', () => {
		expect(() => classifyAnthropicError(new Error('Network failure'))).toThrow(TransientError);
	});
});
