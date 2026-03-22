import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSTTProvider } from '../../../src/providers/stt/google-stt-provider';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';

function createRecognizeResponse(overrides: Record<string, unknown> = {}) {
	return {
		results: [
			{
				alternatives: [
					{
						transcript: 'hello how are you',
						confidence: 0.98,
						words: [
							{ word: 'hello', startOffset: '1.400s', endOffset: '1.800s', speakerLabel: '1' },
							{ word: 'how', startOffset: '1.900s', endOffset: '2.100s', speakerLabel: '1' },
							{ word: 'are', startOffset: '2.200s', endOffset: '2.400s', speakerLabel: '1' },
							{ word: 'you', startOffset: '2.500s', endOffset: '2.800s', speakerLabel: '1' },
						],
					},
				],
				resultEndOffset: '3.000s',
				languageCode: 'en-US',
			},
		],
		...overrides,
	};
}

function createDiarizedResponse() {
	return {
		results: [
			{
				alternatives: [
					{
						transcript: 'hi how can I help certainly let me check',
						confidence: 0.95,
						words: [
							{ word: 'hi', startOffset: '0.500s', endOffset: '0.800s', speakerLabel: '1' },
							{ word: 'how', startOffset: '0.900s', endOffset: '1.100s', speakerLabel: '1' },
							{ word: 'can', startOffset: '1.200s', endOffset: '1.400s', speakerLabel: '1' },
							{ word: 'I', startOffset: '1.500s', endOffset: '1.600s', speakerLabel: '1' },
							{ word: 'help', startOffset: '1.700s', endOffset: '2.000s', speakerLabel: '1' },
							{ word: 'certainly', startOffset: '3.000s', endOffset: '3.500s', speakerLabel: '2' },
							{ word: 'let', startOffset: '3.600s', endOffset: '3.800s', speakerLabel: '2' },
							{ word: 'me', startOffset: '3.900s', endOffset: '4.000s', speakerLabel: '2' },
							{ word: 'check', startOffset: '4.100s', endOffset: '4.500s', speakerLabel: '2' },
						],
					},
				],
			},
		],
	};
}

function createNoDiarizationResponse() {
	return {
		results: [
			{
				alternatives: [
					{
						transcript: 'hello world',
						confidence: 0.95,
						words: [
							{ word: 'hello', startOffset: '0.500s', endOffset: '0.800s' },
							{ word: 'world', startOffset: '0.900s', endOffset: '1.200s' },
						],
					},
				],
			},
		],
	};
}

function createFetchSuccess(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
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

describe('GoogleSTTProvider', () => {
	let provider: GoogleSTTProvider;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		provider = new GoogleSTTProvider();
		provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'my-api-key', location: 'us' });
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('should have name "google"', () => {
		expect(provider.name).toBe('google');
	});

	describe('getSupportedModels', () => {
		it('should return Chirp models with diarization support', () => {
			const models = provider.getSupportedModels();
			expect(models).toHaveLength(2);
			expect(models[0].id).toBe('chirp_3');
			expect(models[0].supportsDiarization).toBe(true);
			expect(models[1].id).toBe('chirp_2');
		});
	});

	describe('transcribe', () => {
		const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
		const defaultOptions = { model: 'chirp_3', language: 'en-US' };

		it('should transcribe with diarization and merge speaker segments', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createDiarizedResponse()));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.provider).toBe('google');
			expect(result.model).toBe('chirp_3');
			expect(result.language).toBe('en-US');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].speaker).toBe('Participant 1');
			expect(result.segments[0].text).toBe('hi how can I help');
			expect(result.segments[0].start).toBeCloseTo(0.5);
			expect(result.segments[0].end).toBeCloseTo(2.0);
			expect(result.segments[1].speaker).toBe('Participant 2');
			expect(result.segments[1].text).toBe('certainly let me check');
			expect(result.segments[1].start).toBeCloseTo(3.0);
			expect(result.segments[1].end).toBeCloseTo(4.5);
		});

		it('should transcribe without diarization (no speakerLabel)', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createNoDiarizationResponse()));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].speaker).toBeUndefined();
			expect(result.segments[0].text).toBe('hello world');
			expect(result.segments[0].start).toBeCloseTo(0.5);
			expect(result.segments[0].end).toBeCloseTo(1.2);
		});

		it('should parse timestamps from string format correctly', async () => {
			const response = {
				results: [{
					alternatives: [{
						transcript: 'test',
						words: [
							{ word: 'test', startOffset: '123.456s', endOffset: '125.789s', speakerLabel: '1' },
						],
					}],
				}],
			};
			fetchSpy.mockResolvedValue(createFetchSuccess(response));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.segments[0].start).toBeCloseTo(123.456);
			expect(result.segments[0].end).toBeCloseTo(125.789);
		});

		it('should merge consecutive words from same speaker into segments', async () => {
			const response = {
				results: [{
					alternatives: [{
						transcript: 'a b c d e',
						words: [
							{ word: 'a', startOffset: '0s', endOffset: '0.5s', speakerLabel: '1' },
							{ word: 'b', startOffset: '0.6s', endOffset: '1.0s', speakerLabel: '1' },
							{ word: 'c', startOffset: '1.5s', endOffset: '2.0s', speakerLabel: '2' },
							{ word: 'd', startOffset: '2.5s', endOffset: '3.0s', speakerLabel: '1' },
							{ word: 'e', startOffset: '3.1s', endOffset: '3.5s', speakerLabel: '1' },
						],
					}],
				}],
			};
			fetchSpy.mockResolvedValue(createFetchSuccess(response));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.segments).toHaveLength(3);
			expect(result.segments[0]).toEqual(expect.objectContaining({ speaker: 'Participant 1', text: 'a b' }));
			expect(result.segments[1]).toEqual(expect.objectContaining({ speaker: 'Participant 2', text: 'c' }));
			expect(result.segments[2]).toEqual(expect.objectContaining({ speaker: 'Participant 1', text: 'd e' }));
		});

		it('should throw ConfigError for 401 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(401));

			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(ConfigError);
		});

		it('should throw ConfigError for 403 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(403));

			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(ConfigError);
		});

		it('should throw DataError for 400 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(400, { message: 'bad audio' }));

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

		it('should throw TransientError for 503 response', async () => {
			fetchSpy.mockResolvedValue(createFetchError(503));

			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should throw TransientError on network error', async () => {
			fetchSpy.mockRejectedValue(new Error('fetch failed'));

			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(TransientError);
		});

		it('should pass language in languageCodes array', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(audio, { model: 'chirp_3', language: 'ko-KR' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.config.languageCodes).toEqual(['ko-KR']);
		});

		it('should default to en-US when language is not provided', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(audio, { model: 'chirp_3' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.config.languageCodes).toEqual(['en-US']);
		});

		it('should send audio as base64-encoded content', async () => {
			const testAudio = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(testAudio, defaultOptions);

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.content).toBe(btoa('Hello'));
		});

		it('should build correct request body structure', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(audio, { model: 'chirp_2', language: 'ja-JP' });

			const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
			expect(callBody.config).toEqual({
				autoDecodingConfig: {},
				model: 'chirp_2',
				languageCodes: ['ja-JP'],
				features: {
					enableWordTimeOffsets: true,
					diarizationConfig: {},
				},
			});
			expect(callBody.content).toBeDefined();
		});

		it('should use correct API URL with project and location', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'test-project', apiKey: 'test-key', location: 'eu' });
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(audio, defaultOptions);

			expect(fetchSpy).toHaveBeenCalledWith(
				'https://speech.googleapis.com/v2/projects/test-project/locations/eu/recognizers/_:recognize',
				expect.objectContaining({
					method: 'POST',
					headers: {
						'X-goog-api-key': 'test-key',
						'Content-Type': 'application/json',
					},
				}),
			);
		});

		it('should use X-goog-api-key header (not Authorization: Bearer)', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			await provider.transcribe(audio, defaultOptions);

			const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
			expect(headers['X-goog-api-key']).toBe('my-api-key');
			expect(headers['Authorization']).toBeUndefined();
		});

		it('should handle response with no words (fallback to transcript text)', async () => {
			const response = {
				results: [{
					alternatives: [{
						transcript: 'some transcribed text',
					}],
				}],
			};
			fetchSpy.mockResolvedValue(createFetchSuccess(response));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.fullText).toBe('some transcribed text');
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].text).toBe('some transcribed text');
		});

		it('should handle response with API error field', async () => {
			const response = {
				error: { code: 3, message: 'Invalid audio data' },
			};
			fetchSpy.mockResolvedValue(createFetchSuccess(response));

			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow(DataError);
			await expect(provider.transcribe(audio, defaultOptions)).rejects.toThrow('Invalid audio data');
		});

		it('should return valid TranscriptionResult structure', async () => {
			fetchSpy.mockResolvedValue(createFetchSuccess(createRecognizeResponse()));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.version).toBe(1);
			expect(result.provider).toBe('google');
			expect(result.audioFile).toBe('');
			expect(result.createdAt).toBeDefined();
			expect(new Date(result.createdAt).getTime()).not.toBeNaN();
		});

		it('should handle multiple results entries', async () => {
			const response = {
				results: [
					{
						alternatives: [{
							transcript: 'first part',
							words: [
								{ word: 'first', startOffset: '0s', endOffset: '0.5s', speakerLabel: '1' },
								{ word: 'part', startOffset: '0.6s', endOffset: '1.0s', speakerLabel: '1' },
							],
						}],
					},
					{
						alternatives: [{
							transcript: 'second part',
							words: [
								{ word: 'second', startOffset: '2.0s', endOffset: '2.5s', speakerLabel: '2' },
								{ word: 'part', startOffset: '2.6s', endOffset: '3.0s', speakerLabel: '2' },
							],
						}],
					},
				],
			};
			fetchSpy.mockResolvedValue(createFetchSuccess(response));

			const result = await provider.transcribe(audio, defaultOptions);

			expect(result.fullText).toBe('first part second part');
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].speaker).toBe('Participant 1');
			expect(result.segments[1].speaker).toBe('Participant 2');
		});
	});

	describe('validateApiKey', () => {
		it('should return false when projectId is empty', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: '', apiKey: 'api-key', location: 'global' });
			const result = await provider.validateApiKey('api-key');
			expect(result).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('should return false when key is empty', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: '', location: 'global' });
			const result = await provider.validateApiKey('');
			expect(result).toBe(false);
		});

		it('should return false for 401 response', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'bad-key', location: 'global' });
			fetchSpy.mockResolvedValue({ status: 401 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return false for 403 response', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'bad-key', location: 'global' });
			fetchSpy.mockResolvedValue({ status: 403 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return true for 200 response', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'good-key', location: 'global' });
			fetchSpy.mockResolvedValue({ status: 200 } as Response);
			const result = await provider.validateApiKey('good-key');
			expect(result).toBe(true);
		});

		it('should return false on network error', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'key', location: 'global' });
			fetchSpy.mockRejectedValue(new Error('Network error'));
			const result = await provider.validateApiKey('key');
			expect(result).toBe(false);
		});

		it('should use X-goog-api-key header (not Authorization: Bearer)', async () => {
			provider.setCredentials({ type: 'google-cloud', projectId: 'my-project', apiKey: 'my-key', location: 'us-central1' });
			fetchSpy.mockResolvedValue({ status: 200 } as Response);
			await provider.validateApiKey('my-key');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://speech.googleapis.com/v2/projects/my-project/locations/us-central1/recognizers',
				expect.objectContaining({
					method: 'GET',
					headers: { 'X-goog-api-key': 'my-key' },
				}),
			);
		});
	});
});
