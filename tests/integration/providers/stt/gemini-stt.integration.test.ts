import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hasEnvVars, requireEnv } from '../../helpers/env-guard';
import { GeminiSTTProvider } from '../../../../src/providers/stt/gemini-stt-provider';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

describe.skipIf(!hasEnvVars('GEMINI_API_KEY'))('Gemini STT Integration', () => {
	let provider: GeminiSTTProvider;
	let audio: ArrayBuffer;

	beforeAll(() => {
		provider = new GeminiSTTProvider();
		provider.setCredentials({ type: 'gemini', apiKey: requireEnv('GEMINI_API_KEY') });

		const buffer = readFileSync(resolve(FIXTURES_DIR, 'test-audio.wav'));
		audio = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	});

	it('should validate valid credentials', async () => {
		const result = await provider.validateApiKey(requireEnv('GEMINI_API_KEY'));
		expect(result).toBe(true);
	});

	it('should transcribe audio and return a valid TranscriptionResult', async () => {
		const result = await provider.transcribe(audio, {
			model: 'gemini-2.5-flash',
			language: 'en',
			audioMimeType: 'audio/wav',
			audioFileName: 'test-audio.wav',
		});

		expect(result.provider).toBe('gemini');
		expect(result.model).toBe('gemini-2.5-flash');
		expect(result.segments.length).toBeGreaterThan(0);
		expect(result.fullText).toBeTruthy();
		expect(result.version).toBe(1);
		expect(result.createdAt).toBeTruthy();

		// Verify segment structure
		for (const segment of result.segments) {
			expect(segment.text).toBeTruthy();
			expect(typeof segment.start).toBe('number');
			expect(typeof segment.end).toBe('number');
		}
	}, 60000);

	it('should handle invalid credentials gracefully', async () => {
		const badProvider = new GeminiSTTProvider();
		badProvider.setCredentials({ type: 'gemini', apiKey: 'invalid-api-key' });

		const result = await badProvider.validateApiKey('invalid-api-key');
		expect(result).toBe(false);
	});
});
