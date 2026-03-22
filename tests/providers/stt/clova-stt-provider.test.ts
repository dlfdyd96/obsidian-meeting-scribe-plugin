import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClovaSpeechSTTProvider } from '../../../src/providers/stt/clova-stt-provider';
import { TransientError, ConfigError, DataError } from '../../../src/utils/errors';

// Mock obsidian's requestUrl
const mockRequestUrl = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

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

function mockRequestUrlSuccess(body: unknown) {
	mockRequestUrl.mockResolvedValue({
		status: 200,
		json: body,
		text: JSON.stringify(body),
	});
}

function mockRequestUrlError(status: number, body?: unknown) {
	const error = new Error(`Request failed, status ${status}`) as Error & { status: number };
	error.status = status;
	if (body) {
		Object.assign(error, { json: body, text: JSON.stringify(body) });
	}
	mockRequestUrl.mockRejectedValue(error);
}

describe('ClovaSpeechSTTProvider', () => {
	let provider: ClovaSpeechSTTProvider;

	beforeEach(() => {
		provider = new ClovaSpeechSTTProvider();
		provider.setCredentials({ type: 'clova', invokeUrl: 'https://clovaspeech.example.com', secretKey: 'test-secret-key' });
		mockRequestUrl.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(mockRequestUrl).toHaveBeenCalledOnce();
			const callArg = mockRequestUrl.mock.calls[0][0];
			expect(callArg.url).toBe('https://clovaspeech.example.com/recognizer/upload');
			expect(callArg.method).toBe('POST');
			expect(callArg.headers['X-CLOVASPEECH-API-KEY']).toBe('test-secret-key');
			expect(callArg.contentType).toMatch(/^multipart\/form-data; boundary=/);
		});

		it('should include correct params in multipart body', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync', language: 'en-US' });

			const callArg = mockRequestUrl.mock.calls[0][0];
			const bodyText = new TextDecoder().decode(callArg.body);
			expect(bodyText).toContain('"language":"en-US"');
			expect(bodyText).toContain('"completion":"sync"');
			expect(bodyText).toContain('"fullText":true');
			expect(bodyText).toContain('"diarization"');
		});

		it('should default language to ko-KR when not specified', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			const callArg = mockRequestUrl.mock.calls[0][0];
			const bodyText = new TextDecoder().decode(callArg.body);
			expect(bodyText).toContain('"language":"ko-KR"');
		});

		it('should include media in multipart body', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), {
				model: 'clova-sync',
				audioMimeType: 'audio/mp3',
				audioFileName: 'recording.mp3',
			});

			const callArg = mockRequestUrl.mock.calls[0][0];
			const bodyText = new TextDecoder().decode(callArg.body);
			expect(bodyText).toContain('name="media"');
			expect(bodyText).toContain('filename="recording.mp3"');
			expect(bodyText).toContain('Content-Type: audio/mp3');
		});

		it('should convert timestamps from milliseconds to seconds', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].start).toBe(1);
			expect(result.segments[0].end).toBe(3);
			expect(result.segments[1].start).toBe(4);
			expect(result.segments[1].end).toBe(6.5);
		});

		it('should map speaker labels to Participant N format', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].speaker).toBe('Participant 1');
			expect(result.segments[1].speaker).toBe('Participant 2');
		});

		it('should populate TranscriptionResult fields correctly', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

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
			mockRequestUrlSuccess(response);

			const result = await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			expect(result.segments[0].speaker).toBeUndefined();
			expect(result.segments[0].text).toBe('No speaker info.');
		});

		it('should use wav as default filename and MIME type when not specified', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' });

			const callArg = mockRequestUrl.mock.calls[0][0];
			const bodyText = new TextDecoder().decode(callArg.body);
			expect(bodyText).toContain('filename="audio.wav"');
			expect(bodyText).toContain('Content-Type: audio/wav');
			expect(bodyText).not.toContain('audio/webm');
			expect(bodyText).not.toContain('audio.webm');
		});

		it('should use provided filename and MIME type from options', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

			await provider.transcribe(new ArrayBuffer(100), {
				model: 'clova-sync',
				audioMimeType: 'audio/mp4',
				audioFileName: 'recording.m4a',
			});

			const callArg = mockRequestUrl.mock.calls[0][0];
			const bodyText = new TextDecoder().decode(callArg.body);
			expect(bodyText).toContain('filename="recording.m4a"');
			expect(bodyText).toContain('Content-Type: audio/mp4');
		});

		it('should set language from options in result', async () => {
			mockRequestUrlSuccess(makeClovaResponse());

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
			mockRequestUrlSuccess(response);

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toSatisfy((err: Error) =>
					err instanceof DataError && err.message.includes('Audio format not supported'),
				);
		});

		it('should throw ConfigError for 401 response', async () => {
			mockRequestUrlError(401, { message: 'Unauthorized' });

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw ConfigError for 403 response', async () => {
			mockRequestUrlError(403, { message: 'Forbidden' });

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw DataError for 400 response', async () => {
			mockRequestUrlError(400, { message: 'Bad request' });

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(DataError);
		});

		it('should throw TransientError for 429 response (rate limited)', async () => {
			mockRequestUrlError(429, { message: 'Rate limited' });

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw TransientError for 500 response', async () => {
			mockRequestUrlError(500, { message: 'Server error' });

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw TransientError for 503 response', async () => {
			mockRequestUrlError(503);

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw TransientError on network error', async () => {
			mockRequestUrl.mockRejectedValue(new Error('Network failure'));

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
		});

		it('should throw ConfigError (not TransientError) for 401 via throw:false path', async () => {
			// Simulates requestUrl with throw:false returning error status instead of throwing
			mockRequestUrl.mockResolvedValue({
				status: 401,
				json: {},
				text: 'Unauthorized',
			});

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(ConfigError);
		});

		it('should throw DataError (not TransientError) for 400 via throw:false path', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 400,
				json: {},
				text: 'Bad request',
			});

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(DataError);
		});

		it('should throw TransientError for 429 via throw:false path', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 429,
				json: {},
				text: 'Rate limited',
			});

			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow(TransientError);
			await expect(provider.transcribe(new ArrayBuffer(100), { model: 'clova-sync' }))
				.rejects.toThrow('Rate limited');
		});
	});

	describe('validateApiKey', () => {
		it('should return false when invokeUrl is empty', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: '', secretKey: 'secret-key' });
			const result = await provider.validateApiKey('secret-key');
			expect(result).toBe(false);
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('should return false when key is empty', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: '' });
			const result = await provider.validateApiKey('');
			expect(result).toBe(false);
		});

		it('should return false for 401 response', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: 'bad-key' });
			mockRequestUrlError(401);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return true for non-401/403 error status (credentials valid, bad request)', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: 'good-key' });
			mockRequestUrlError(400);
			const result = await provider.validateApiKey('good-key');
			expect(result).toBe(true);
		});

		it('should return true for successful response', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: 'good-key' });
			mockRequestUrl.mockResolvedValue({ status: 200, json: {} });
			const result = await provider.validateApiKey('good-key');
			expect(result).toBe(true);
		});

		it('should return false on network error', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: 'key' });
			mockRequestUrl.mockRejectedValue(new Error('Network error'));
			const result = await provider.validateApiKey('key');
			expect(result).toBe(false);
		});

		it('should send correct request parameters', async () => {
			provider.setCredentials({ type: 'clova', invokeUrl: 'https://example.com', secretKey: 'my-secret' });
			mockRequestUrl.mockResolvedValue({ status: 200, json: {} });
			await provider.validateApiKey('my-secret');
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://example.com/recognizer/upload',
					method: 'POST',
					headers: expect.objectContaining({
						'X-CLOVASPEECH-API-KEY': 'my-secret',
					}),
				}),
			);
		});
	});
});
