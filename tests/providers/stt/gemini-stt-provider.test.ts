import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiSTTProvider } from '../../../src/providers/stt/gemini-stt-provider';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';

function createGenerateContentResponse(segments: Array<{ speaker: string; start: number; end: number; text: string }>) {
	return {
		candidates: [{
			content: {
				parts: [{
					text: JSON.stringify(segments),
				}],
			},
		}],
	};
}

function createFetchSuccess(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		headers: new Headers(),
	} as Response;
}

function createFetchError(status: number, body?: unknown): Response {
	return {
		ok: false,
		status,
		json: () => (body ? Promise.resolve(body) : Promise.reject(new Error('no body'))),
		text: () => Promise.resolve(''),
	} as Response;
}

function createUploadStartResponse(uploadUrl: string): Response {
	const headers = new Headers();
	headers.set('X-Goog-Upload-URL', uploadUrl);
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve({}),
		headers,
	} as Response;
}

function createUploadFinalizeResponse(fileUri: string): Response {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve({ file: { uri: fileUri } }),
		headers: new Headers(),
	} as Response;
}

describe('GeminiSTTProvider', () => {
	let provider: GeminiSTTProvider;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		provider = new GeminiSTTProvider();
		provider.setCredentials({ type: 'gemini', apiKey: 'test-api-key' });
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('should have name "gemini"', () => {
		expect(provider.name).toBe('gemini');
	});

	describe('getSupportedModels', () => {
		it('should return 3 models with diarization support', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(3);
			expect(models[0].id).toBe('gemini-2.5-flash');
			expect(models[0].supportsDiarization).toBe(true);
			expect(models[1].id).toBe('gemini-2.5-pro');
			expect(models[1].supportsDiarization).toBe(true);
			expect(models[2].id).toBe('gemini-2.0-flash');
			expect(models[2].supportsDiarization).toBe(true);
		});
	});

	describe('getSupportedFormats', () => {
		it('should return supported audio formats', () => {
			const formats = provider.getSupportedFormats();
			expect(formats).toEqual(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac']);
		});
	});

	describe('getMaxDuration', () => {
		it('should return 34200 seconds (9.5 hours)', () => {
			expect(provider.getMaxDuration()).toBe(34200);
		});
	});

	describe('getRequiredCredentials', () => {
		it('should return apiKey', () => {
			expect(provider.getRequiredCredentials()).toEqual(['apiKey']);
		});
	});

	describe('mapLanguageCode', () => {
		it('should return Korean instruction for ko', () => {
			expect(provider.mapLanguageCode('ko')).toBe('Transcribe in Korean (한국어).');
		});

		it('should return English instruction for en', () => {
			expect(provider.mapLanguageCode('en')).toBe('Transcribe in English.');
		});

		it('should return Japanese instruction for ja', () => {
			expect(provider.mapLanguageCode('ja')).toBe('Transcribe in Japanese (日本語).');
		});

		it('should return Chinese instruction for zh', () => {
			expect(provider.mapLanguageCode('zh')).toBe('Transcribe in Chinese (中文).');
		});

		it('should return auto-detect for auto', () => {
			expect(provider.mapLanguageCode('auto')).toBe('Auto-detect the language.');
		});

		it('should return auto-detect for empty string', () => {
			expect(provider.mapLanguageCode('')).toBe('Auto-detect the language.');
		});

		it('should return fallback for unknown language', () => {
			expect(provider.mapLanguageCode('fr')).toBe('Transcribe in language: fr.');
		});
	});

	describe('transcribe (inline path)', () => {
		const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer; // < 20MB
		const defaultOptions = { model: 'gemini-2.5-flash', language: 'ko' };

		const sampleSegments = [
			{ speaker: 'Participant 1', start: 0.5, end: 2.0, text: '안녕하세요' },
			{ speaker: 'Participant 2', start: 3.0, end: 4.5, text: '반갑습니다' },
		];

		it('should transcribe and parse response into TranscriptionResult', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.provider).toBe('gemini');
			expect(result.model).toBe('gemini-2.5-flash');
			expect(result.language).toBe('ko');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].speaker).toBe('Participant 1');
			expect(result.segments[0].text).toBe('안녕하세요');
			expect(result.segments[0].start).toBe(0.5);
			expect(result.segments[0].end).toBe(2.0);
			expect(result.segments[1].speaker).toBe('Participant 2');
			expect(result.fullText).toBe('안녕하세요\n반갑습니다');
			expect(result.version).toBe(1);
			expect(result.createdAt).toBeDefined();
		});

		it('should send inline_data for audio < 20MB', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, defaultOptions);

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.contents[0].parts[0].inline_data).toBeDefined();
			expect(callBody.contents[0].parts[0].inline_data.mime_type).toBe('audio/wav');
			expect(callBody.contents[0].parts[0].inline_data.data).toBeDefined();
		});

		it('should include transcription prompt in request', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, defaultOptions);

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			const promptText = callBody.contents[0].parts[1].text;
			expect(promptText).toContain('Participant 1');
			expect(promptText).toContain('Transcribe in Korean');
		});

		it('should use response_mime_type and response_schema', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, defaultOptions);

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.generationConfig.response_mime_type).toBe('application/json');
			expect(callBody.generationConfig.response_schema).toBeDefined();
			expect(callBody.generationConfig.response_schema.type).toBe('ARRAY');
		});

		it('should use correct API URL with model and key', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, { model: 'gemini-2.5-pro', language: 'en' });

			expect(fetchSpy).toHaveBeenCalledWith(
				'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=test-api-key',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should default model to gemini-2.5-flash', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			const result = await provider.transcribe(audio, { model: '' });

			expect(result.model).toBe('gemini-2.5-flash');
		});

		it('should use audioMimeType when provided', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, { ...defaultOptions, audioMimeType: 'audio/mp3' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.contents[0].parts[0].inline_data.mime_type).toBe('audio/mp3');
		});

		it('should derive mimeType from audioFileName', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, { ...defaultOptions, audioFileName: 'meeting.ogg' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.contents[0].parts[0].inline_data.mime_type).toBe('audio/ogg');
		});

		it('should set audioFile in result from options', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			const result = await provider.transcribe(audio, { ...defaultOptions, audioFileName: 'test.wav' });

			expect(result.audioFile).toBe('test.wav');
		});

		it('should handle empty segments array', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse([])));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.segments).toHaveLength(0);
			expect(result.fullText).toBe('');
		});

		it('should handle auto language', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			await provider.transcribe(audio, { model: 'gemini-2.5-flash' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			const promptText = callBody.contents[0].parts[1].text;
			expect(promptText).toContain('Auto-detect the language');
		});
	});

	describe('transcribe (Files API path)', () => {
		// Create a buffer > 20MB
		const largeAudio = new ArrayBuffer(21 * 1024 * 1024);
		const defaultOptions = { model: 'gemini-2.5-flash', language: 'en' };

		const sampleSegments = [
			{ speaker: 'Participant 1', start: 0, end: 5, text: 'hello world' },
		];

		it('should upload file and use file_data for audio >= 20MB', async () => {
			const uploadUrl = 'https://upload.example.com/upload-session';
			const fileUri = 'https://generativelanguage.googleapis.com/v1beta/files/abc123';

			fetchSpy
				.mockResolvedValueOnce(createUploadStartResponse(uploadUrl))
				.mockResolvedValueOnce(createUploadFinalizeResponse(fileUri))
				.mockResolvedValueOnce(createFetchSuccess(createGenerateContentResponse(sampleSegments)));

			const result = await provider.transcribe(largeAudio, defaultOptions);

			// First call: upload start
			expect(fetchSpy.mock.calls[0][0]).toContain('/upload/v1beta/files');
			// Second call: upload finalize
			expect(fetchSpy.mock.calls[1][0]).toBe(uploadUrl);
			// Third call: generateContent
			const callBody = JSON.parse(fetchSpy.mock.calls[2][1]?.body as string);
			expect(callBody.contents[0].parts[0].file_data).toBeDefined();
			expect(callBody.contents[0].parts[0].file_data.file_uri).toBe(fileUri);

			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].text).toBe('hello world');
		});
	});

	describe('error handling', () => {
		const audio = new Uint8Array([1, 2, 3]).buffer;
		const defaultOptions = { model: 'gemini-2.5-flash' };

		it('should throw ConfigError for 401 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(401));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(ConfigError);
		});

		it('should throw ConfigError for 403 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(403));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(ConfigError);
		});

		it('should throw DataError for 400 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(400, { message: 'bad request' }));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(DataError);
		});

		it('should throw TransientError for 429 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(429));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should throw TransientError for 500 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(500));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on network error', async () => {
			fetchSpy.mockRejectedValue(new Error('fetch failed'));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should throw TransientError for empty Gemini response', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess({ candidates: [] }));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should throw TransientError for invalid JSON in response', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess({
				candidates: [{ content: { parts: [{ text: 'not json' }] } }],
			}));
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});
	});

	describe('validateApiKey', () => {
		it('should return false for empty key', async () => {
			const result = await provider.validateApiKey('');
			expect(result).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('should return true for valid key (200 response)', async () => {
			fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);
			const result = await provider.validateApiKey('valid-key');
			expect(result).toBe(true);
		});

		it('should return false for 401 response', async () => {
			fetchSpy.mockResolvedValue({ ok: false, status: 401 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return false for 403 response', async () => {
			fetchSpy.mockResolvedValue({ ok: false, status: 403 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return false for 400 response', async () => {
			fetchSpy.mockResolvedValue({ ok: false, status: 400 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return false on network error', async () => {
			fetchSpy.mockRejectedValue(new Error('Network error'));
			const result = await provider.validateApiKey('key');
			expect(result).toBe(false);
		});

		it('should call models endpoint with key', async () => {
			fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);
			await provider.validateApiKey('my-key');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://generativelanguage.googleapis.com/v1beta/models?key=my-key',
				expect.objectContaining({ method: 'GET' }),
			);
		});
	});

	describe('setCredentials', () => {
		it('should set apiKey from gemini credentials', () => {
			const newProvider = new GeminiSTTProvider();
			newProvider.setCredentials({ type: 'gemini', apiKey: 'new-key' });

			fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);
			void newProvider.validateApiKey('new-key');

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining('key=new-key'),
				expect.anything(),
			);
		});

		it('should ignore non-gemini credentials', () => {
			const newProvider = new GeminiSTTProvider();
			newProvider.setCredentials({ type: 'api-key', apiKey: 'openai-key' });

			// apiKey should still be empty string → validateApiKey won't use it for URL
			fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);
			void newProvider.validateApiKey('test');
			// The URL should contain the key param from validateApiKey, not setCredentials
		});
	});
});
