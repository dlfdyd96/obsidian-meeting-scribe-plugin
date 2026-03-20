import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClovaSpeechSTTProvider } from '../../../src/providers/stt/clova-stt-provider';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';

function makeClovaResponse(overrides: Record<string, unknown> = {}) {
	return {
		result: 'COMPLETED',
		message: 'Succeeded',
		segments: [
			{
				start: 1000,
				end: 3000,
				text: 'Hello world.',
				confidence: 0.95,
				diarization: { label: '1' },
				speaker: { label: '1', name: 'A', edited: false },
				words: [[1000, 1500, 'Hello'], [1500, 3000, 'world.']],
			},
			{
				start: 4000,
				end: 6500,
				text: 'How are you?',
				confidence: 0.92,
				diarization: { label: '2' },
				speaker: { label: '2', name: 'B', edited: false },
				words: [[4000, 4800, 'How'], [4800, 5500, 'are'], [5500, 6500, 'you?']],
			},
		],
		text: 'Hello world. How are you?',
		speakers: [
			{ label: '1', name: 'A', edited: false },
			{ label: '2', name: 'B', edited: false },
		],
		...overrides,
	};
}

function mockFetchResponse(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as Response;
}

describe('ClovaSpeechSTTProvider', () => {
	let provider: ClovaSpeechSTTProvider;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		provider = new ClovaSpeechSTTProvider();
		provider.setCredentials('https://clovaspeech.example.com', 'test-secret-key');
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('should have name "clova"', () => {
		expect(provider.name).toBe('clova');
	});

	describe('getSupportedModels', () => {
		it('should return CLOVA Speech sync model with diarization support', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(1);
			expect(models[0].id).toBe('clova-sync');
			expect(models[0].supportsDiarization).toBe(true);
		});
	});

	describe('transcribe', () => {
		it('should send correct request to CLOVA Speech API', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url, init] = fetchSpy.mock.calls[0];
			expect(url).toBe('https://clovaspeech.example.com/recognizer/upload');
			expect(init?.method).toBe('POST');
			expect((init?.headers as Record<string, string>)['X-CLOVASPEECH-API-KEY']).toBe('test-secret-key');
			expect(init?.body).toBeInstanceOf(FormData);
		});

		it('should include correct params in FormData', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync', language: 'en-US' });

			const formData = fetchSpy.mock.calls[0][1]?.body as FormData;
			const paramsStr = formData.get('params') as string;
			const params = JSON.parse(paramsStr);

			expect(params.language).toBe('en-US');
			expect(params.completion).toBe('sync');
			expect(params.fullText).toBe(true);
			expect(params.diarization.enable).toBe(true);
			expect(params.wordAlignment).toBe(true);
			expect(params.noiseFiltering).toBe(true);
		});

		it('should default language to ko-KR when not specified', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			const formData = fetchSpy.mock.calls[0][1]?.body as FormData;
			const params = JSON.parse(formData.get('params') as string);
			expect(params.language).toBe('ko-KR');
		});

		it('should include media blob in FormData', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			await provider.transcribe(new ArrayBuffer(100), {
				model: 'clova-sync',
				audioMimeType: 'audio/mp3',
				audioFileName: 'recording.mp3',
			});

			const formData = fetchSpy.mock.calls[0][1]?.body as FormData;
			const media = formData.get('media');
			expect(media).toBeInstanceOf(Blob);
		});

		it('should convert timestamps from milliseconds to seconds', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].start).toBe(1);
			expect(result.segments[0].end).toBe(3);
			expect(result.segments[1].start).toBe(4);
			expect(result.segments[1].end).toBe(6.5);
		});

		it('should map speaker labels to Participant N format', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].speaker).toBe('Participant 1');
			expect(result.segments[1].speaker).toBe('Participant 2');
		});

		it('should populate TranscriptionResult fields correctly', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.version).toBe(1);
			expect(result.provider).toBe('clova');
			expect(result.model).toBe('clova-sync');
			expect(result.fullText).toBe('Hello world. How are you?');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].text).toBe('Hello world.');
			expect(result.segments[1].text).toBe('How are you?');
			expect(result.createdAt).toBeTruthy();
			expect(result.audioFile).toBe('');
		});

		it('should handle segments without speaker diarization', async () => {
			const response = makeClovaResponse({
				segments: [
					{
						start: 0,
						end: 2000,
						text: 'No speaker info.',
						confidence: 0.9,
						words: [],
					},
				],
			});
			fetchSpy.mockResolvedValue(mockFetchResponse(200, response));

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].speaker).toBeUndefined();
			expect(result.segments[0].text).toBe('No speaker info.');
		});

		it('should set language from options in result', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(200, makeClovaResponse()));

			const result = await provider.transcribe(new ArrayBuffer(100), {
				model: 'clova-sync',
				language: 'enko',
			});

			expect(result.language).toBe('enko');
		});

		it('should throw DataError when result is not COMPLETED', async () => {
			const response = makeClovaResponse({
				result: 'FAILED',
				message: 'Audio format not supported',
			});
			fetchSpy.mockResolvedValue(mockFetchResponse(200, response));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toSatisfy((err: Error) =>
					err instanceof DataError && err.message.includes('Audio format not supported'),
				);
		});

		it('should throw ConfigError for 401 response', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(401, { message: 'Unauthorized' }));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw ConfigError for 403 response', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(403, { message: 'Forbidden' }));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw DataError for 400 response', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(400, { message: 'Bad request' }));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(DataError);
		});

		it('should throw ConfigError for 429 response (quota exceeded)', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(429, { message: 'Quota exceeded' }));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw TransientError for 500 response', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(500, { message: 'Server error' }));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw TransientError for 503 response', async () => {
			fetchSpy.mockResolvedValue(mockFetchResponse(503, {}));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw TransientError on network error', async () => {
			fetchSpy.mockRejectedValue(new Error('Network failure'));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});
	});

	describe('validateApiKey', () => {
		it('should return false when invokeUrl is empty', async () => {
			provider.setCredentials('', 'secret-key');
			const result = await provider.validateApiKey('secret-key');
			expect(result).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('should return false when key is empty', async () => {
			provider.setCredentials('https://example.com', '');
			const result = await provider.validateApiKey('');
			expect(result).toBe(false);
		});

		it('should return false for 401 response', async () => {
			provider.setCredentials('https://example.com', 'bad-key');
			fetchSpy.mockResolvedValue({ status: 401 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return true for non-401/403 response', async () => {
			provider.setCredentials('https://example.com', 'good-key');
			fetchSpy.mockResolvedValue({ status: 400 } as Response);
			const result = await provider.validateApiKey('good-key');
			expect(result).toBe(true);
		});

		it('should return false on network error', async () => {
			provider.setCredentials('https://example.com', 'key');
			fetchSpy.mockRejectedValue(new Error('Network error'));
			const result = await provider.validateApiKey('key');
			expect(result).toBe(false);
		});

		it('should send X-CLOVASPEECH-API-KEY header', async () => {
			provider.setCredentials('https://example.com', 'my-secret');
			fetchSpy.mockResolvedValue({ status: 200 } as Response);
			await provider.validateApiKey('my-secret');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://example.com/recognizer/upload',
				expect.objectContaining({
					method: 'POST',
					headers: { 'X-CLOVASPEECH-API-KEY': 'my-secret' },
				}),
			);
		});
	});
});
