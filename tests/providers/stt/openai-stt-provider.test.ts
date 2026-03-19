import { requestUrl } from 'obsidian';
import { OpenAISTTProvider } from '../../../src/providers/stt/openai-stt-provider';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';
import { logger } from '../../../src/utils/logger';
import {
	createSimpleJsonResponse,
	createVerboseJsonResponse,
	createDiarizedJsonResponse,
	createRequestUrlSuccess,
	createRequestUrlError,
	createFetchSuccess,
	createFetchError,
} from '../../fixtures/openai-responses';

vi.spyOn(logger, 'debug').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});

describe('OpenAISTTProvider', () => {
	let provider: OpenAISTTProvider;
	const mockAudio = new ArrayBuffer(100);

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new OpenAISTTProvider();
		provider.setApiKey('sk-test-key');
	});

	describe('getSupportedModels', () => {
		it('returns all supported models', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(4);
		});

		it('returns whisper-1 without diarization', () => {
			const models = provider.getSupportedModels();
			const whisperModel = models.find((m) => m.id === 'whisper-1');
			expect(whisperModel).toBeDefined();
			expect(whisperModel!.name).toBe('Whisper v1');
			expect(whisperModel!.supportsDiarization).toBe(false);
		});

		it('returns gpt-4o-mini-transcribe without diarization', () => {
			const models = provider.getSupportedModels();
			const miniModel = models.find((m) => m.id === 'gpt-4o-mini-transcribe');
			expect(miniModel).toBeDefined();
			expect(miniModel!.name).toBe('GPT-4o Mini Transcribe');
			expect(miniModel!.supportsDiarization).toBe(false);
		});

		it('returns gpt-4o-transcribe without diarization', () => {
			const models = provider.getSupportedModels();
			const model = models.find((m) => m.id === 'gpt-4o-transcribe');
			expect(model).toBeDefined();
			expect(model!.name).toBe('GPT-4o Transcribe');
			expect(model!.supportsDiarization).toBe(false);
		});

		it('returns gpt-4o-transcribe-diarize with diarization', () => {
			const models = provider.getSupportedModels();
			const diarizeModel = models.find((m) => m.id === 'gpt-4o-transcribe-diarize');
			expect(diarizeModel).toBeDefined();
			expect(diarizeModel!.name).toBe('GPT-4o Transcribe (Diarization)');
			expect(diarizeModel!.supportsDiarization).toBe(true);
		});
	});

	describe('transcribe - gpt-4o-mini-transcribe', () => {
		it('sends correct fetch request with FormData', async () => {
			const responseData = createSimpleJsonResponse();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			await provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' });

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url, init] = fetchSpy.mock.calls[0]!;
			expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
			expect(init!.method).toBe('POST');
			expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-key');

			const formData = init!.body as FormData;
			expect(formData.get('model')).toBe('gpt-4o-mini-transcribe');
			expect(formData.get('response_format')).toBe('json');
			expect(formData.get('file')).toBeInstanceOf(Blob);
		});

		it('parses simple json response into single-segment TranscriptionResult', async () => {
			const responseData = createSimpleJsonResponse();
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			const result = await provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' });

			expect(result.version).toBe(1);
			expect(result.provider).toBe('openai');
			expect(result.model).toBe('gpt-4o-mini-transcribe');
			expect(result.language).toBe('auto');
			expect(result.fullText).toBe('Hello, this is a test transcription.');
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0]).toEqual({
				start: 0,
				end: 0,
				text: 'Hello, this is a test transcription.',
			});
			expect(result.createdAt).toBeDefined();
		});
	});

	describe('transcribe - whisper-1', () => {
		it('sends verbose_json with timestamp_granularities', async () => {
			const responseData = createVerboseJsonResponse();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			await provider.transcribe(mockAudio, { model: 'whisper-1' });

			const formData = fetchSpy.mock.calls[0]![1]!.body as FormData;
			expect(formData.get('model')).toBe('whisper-1');
			expect(formData.get('response_format')).toBe('verbose_json');
			expect(formData.get('timestamp_granularities[]')).toBe('segment');
		});

		it('parses verbose_json response with segments', async () => {
			const responseData = createVerboseJsonResponse();
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			const result = await provider.transcribe(mockAudio, { model: 'whisper-1' });

			expect(result.provider).toBe('openai');
			expect(result.model).toBe('whisper-1');
			expect(result.language).toBe('en');
			expect(result.fullText).toBe('Hello, this is a test transcription.');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0]).toEqual({
				start: 0.0,
				end: 2.5,
				text: 'Hello, this is',
			});
			expect(result.segments[1]).toEqual({
				start: 2.5,
				end: 5.0,
				text: 'a test transcription.',
			});
		});
	});

	describe('transcribe - diarization model', () => {
		it('sends correct request for diarization model', async () => {
			const responseData = createDiarizedJsonResponse();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			await provider.transcribe(mockAudio, { model: 'gpt-4o-transcribe-diarize' });

			const formData = fetchSpy.mock.calls[0]![1]!.body as FormData;
			expect(formData.get('model')).toBe('gpt-4o-transcribe-diarize');
			expect(formData.get('response_format')).toBe('diarized_json');
			expect(formData.get('chunking_strategy')).toBe('auto');
			expect(formData.get('timestamp_granularities[]')).toBeNull();
		});

		it('parses diarized_json response with speaker labels', async () => {
			const responseData = createDiarizedJsonResponse();
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			const result = await provider.transcribe(mockAudio, { model: 'gpt-4o-transcribe-diarize' });

			expect(result.fullText).toBe('Hello from speaker A. And hello from speaker B.');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0]).toEqual({
				start: 0.0,
				end: 3.0,
				text: 'Hello from speaker A.',
				speaker: 'A',
			});
			expect(result.segments[1]).toEqual({
				start: 3.0,
				end: 6.0,
				text: 'And hello from speaker B.',
				speaker: 'B',
			});
		});

		it('uses request language or auto when diarized response has no language', async () => {
			const responseData = createDiarizedJsonResponse();
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			const result = await provider.transcribe(mockAudio, {
				model: 'gpt-4o-transcribe-diarize',
				language: 'ko',
			});
			expect(result.language).toBe('ko');

			const resultAuto = await provider.transcribe(mockAudio, {
				model: 'gpt-4o-transcribe-diarize',
			});
			expect(resultAuto.language).toBe('auto');
		});
	});

	describe('language parameter', () => {
		it('forwards language parameter when set', async () => {
			const responseData = createSimpleJsonResponse();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			await provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe', language: 'ko' });

			const formData = fetchSpy.mock.calls[0]![1]!.body as FormData;
			expect(formData.get('language')).toBe('ko');
		});

		it('omits language parameter when not set', async () => {
			const responseData = createSimpleJsonResponse();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchSuccess(responseData));

			await provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' });

			const formData = fetchSpy.mock.calls[0]![1]!.body as FormData;
			expect(formData.get('language')).toBeNull();
		});
	});

	describe('error classification', () => {
		it('throws ConfigError on 401 (invalid key)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				createFetchError(401, { error: { message: 'invalid_api_key', type: 'error' } }),
			);

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(ConfigError);
		});

		it('throws ConfigError on 403 (unsupported region)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				createFetchError(403, { error: { message: 'unsupported_region', type: 'error' } }),
			);

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(ConfigError);
		});

		it('throws TransientError on 429 (rate limit)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				createFetchError(429, { error: { message: 'rate_limit_exceeded', type: 'error' } }),
			);

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(TransientError);
		});

		it('throws ConfigError on 429 with insufficient_quota', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				createFetchError(429, { error: { message: 'insufficient_quota', type: 'error' } }),
			);

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(ConfigError);
		});

		it('throws TransientError on 500 (server error)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchError(500));

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(TransientError);
		});

		it('throws TransientError on 503 (overloaded)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchError(503));

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(TransientError);
		});

		it('throws DataError on 400 (invalid request)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchError(400));

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(DataError);
		});

		it('throws DataError on 400 with error message', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				createFetchError(400, { error: { message: 'Unsupported parameter: language', type: 'invalid_request_error' } }),
			);

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow('Unsupported parameter: language');
		});

		it('throws DataError on 413 (too large)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(createFetchError(413));

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(DataError);
		});

		it('throws TransientError on network error', async () => {
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net::ERR_TIMED_OUT'));

			await expect(
				provider.transcribe(mockAudio, { model: 'gpt-4o-mini-transcribe' }),
			).rejects.toThrow(TransientError);
		});
	});

	describe('validateApiKey', () => {
		it('returns true for valid key', async () => {
			vi.mocked(requestUrl).mockResolvedValue(
				createRequestUrlSuccess({ data: [{ id: 'gpt-4o' }] }),
			);

			const result = await provider.validateApiKey('sk-valid-key');
			expect(result).toBe(true);

			const call = vi.mocked(requestUrl).mock.calls[0]![0] as {
				url: string;
				method: string;
				headers: Record<string, string>;
			};
			expect(call.url).toBe('https://api.openai.com/v1/models');
			expect(call.method).toBe('GET');
			expect(call.headers['Authorization']).toBe('Bearer sk-valid-key');
		});

		it('returns false for invalid key', async () => {
			vi.mocked(requestUrl).mockRejectedValue(
				createRequestUrlError(401),
			);

			const result = await provider.validateApiKey('sk-invalid-key');
			expect(result).toBe(false);
		});
	});

	describe('name property', () => {
		it('has name "openai"', () => {
			expect(provider.name).toBe('openai');
		});
	});
});
