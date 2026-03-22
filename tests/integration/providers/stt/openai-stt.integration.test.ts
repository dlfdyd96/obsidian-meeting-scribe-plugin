import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hasEnvVars, requireEnv } from '../../helpers/env-guard';
import { OpenAISTTProvider } from '../../../../src/providers/stt/openai-stt-provider';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

describe.skipIf(!hasEnvVars('OPENAI_API_KEY'))('OpenAI STT Integration', () => {
	let provider: OpenAISTTProvider;
	let audio: ArrayBuffer;

	beforeAll(() => {
		provider = new OpenAISTTProvider();
		provider.setCredentials({ type: 'api-key', apiKey: requireEnv('OPENAI_API_KEY') });

		const buffer = readFileSync(resolve(FIXTURES_DIR, 'test-audio.m4a'));
		audio = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	});

	it('should validate a valid API key', async () => {
		const result = await provider.validateApiKey(requireEnv('OPENAI_API_KEY'));
		expect(result).toBe(true);
	});

	it('should return false for an invalid API key', async () => {
		const result = await provider.validateApiKey('sk-invalid-key-12345');
		expect(result).toBe(false);
	});

	it('should transcribe audio and return a valid TranscriptionResult', async () => {
		const result = await provider.transcribe(audio, {
			model: 'whisper-1',
			language: 'en',
			audioMimeType: 'audio/mp4',
			audioFileName: 'test-audio.m4a',
		});

		expect(result.provider).toBe('openai');
		expect(result.model).toBe('whisper-1');
		expect(result.segments.length).toBeGreaterThan(0);
		expect(result.fullText).toBeTruthy();
		expect(result.version).toBe(1);
		expect(result.createdAt).toBeTruthy();
	});
});
