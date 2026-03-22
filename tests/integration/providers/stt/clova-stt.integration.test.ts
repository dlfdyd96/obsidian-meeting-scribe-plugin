import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hasEnvVars, requireEnv } from '../../helpers/env-guard';
import { ClovaSpeechSTTProvider } from '../../../../src/providers/stt/clova-stt-provider';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

describe.skipIf(!hasEnvVars('CLOVA_INVOKE_URL', 'CLOVA_SECRET_KEY'))('CLOVA Speech STT Integration', () => {
	let provider: ClovaSpeechSTTProvider;
	let audio: ArrayBuffer;

	beforeAll(() => {
		provider = new ClovaSpeechSTTProvider();
		provider.setCredentials(requireEnv('CLOVA_INVOKE_URL'), requireEnv('CLOVA_SECRET_KEY'));

		const buffer = readFileSync(resolve(FIXTURES_DIR, 'test-audio.m4a'));
		audio = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	});

	it('should validate valid credentials', async () => {
		const result = await provider.validateApiKey(requireEnv('CLOVA_SECRET_KEY'));
		expect(result).toBe(true);
	});

	it('should transcribe audio and return a valid TranscriptionResult', async () => {
		const result = await provider.transcribe(audio, {
			model: 'clova-sync',
			language: 'enko',
			audioMimeType: 'audio/mp4',
			audioFileName: 'test-audio.m4a',
		});

		expect(result.provider).toBe('clova');
		expect(result.model).toBe('clova-sync');
		expect(result.segments.length).toBeGreaterThan(0);
		expect(result.fullText).toBeTruthy();
		expect(result.version).toBe(1);
		expect(result.createdAt).toBeTruthy();
	});

	it('should handle invalid credentials gracefully', async () => {
		const badProvider = new ClovaSpeechSTTProvider();
		// Use a completely invalid invoke URL to trigger a network/auth error
		badProvider.setCredentials('https://invalid-url.example.com/v1/fake', 'invalid-secret-key');

		const result = await badProvider.validateApiKey('invalid-secret-key');
		expect(result).toBe(false);
	});
});
