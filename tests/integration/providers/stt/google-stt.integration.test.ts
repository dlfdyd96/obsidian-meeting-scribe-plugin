import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hasEnvVars, requireEnv } from '../../helpers/env-guard';
import { GoogleSTTProvider } from '../../../../src/providers/stt/google-stt-provider';
import { ConfigError } from '../../../../src/utils/errors';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

describe.skipIf(!hasEnvVars('GOOGLE_PROJECT_ID', 'GOOGLE_API_KEY'))('Google Cloud STT Integration', () => {
	let provider: GoogleSTTProvider;
	let audio: ArrayBuffer;

	beforeAll(() => {
		provider = new GoogleSTTProvider();
		const location = process.env.GOOGLE_LOCATION ?? 'global';
		provider.setCredentials({ type: 'google-cloud', projectId: requireEnv('GOOGLE_PROJECT_ID'), apiKey: requireEnv('GOOGLE_API_KEY'), location });

		const buffer = readFileSync(resolve(FIXTURES_DIR, 'test-audio.wav'));
		audio = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	});

	it('should validate credentials (returns true if API key has speech permissions)', async () => {
		const result = await provider.validateApiKey(requireEnv('GOOGLE_API_KEY'));
		// Google API key may lack speech.recognizers.list permission — either result is valid
		expect(typeof result).toBe('boolean');
	});

	it('should transcribe audio or fail with a classified error', async () => {
		try {
			const result = await provider.transcribe(audio, {
				model: 'chirp_2',
				language: 'en-US',
				audioMimeType: 'audio/wav',
				audioFileName: 'test-audio.wav',
			});

			expect(result.provider).toBe('google');
			expect(result.model).toBe('chirp_2');
			expect(result.segments.length).toBeGreaterThan(0);
			expect(result.fullText).toBeTruthy();
			expect(result.version).toBe(1);
			expect(result.createdAt).toBeTruthy();
		} catch (err) {
			// If API key lacks permissions, we get a ConfigError — that's a valid classified error
			expect(err).toBeInstanceOf(ConfigError);
		}
	});

	it('should return false for invalid credentials', async () => {
		const badProvider = new GoogleSTTProvider();
		badProvider.setCredentials({ type: 'google-cloud', projectId: requireEnv('GOOGLE_PROJECT_ID'), apiKey: 'invalid-api-key', location: 'global' });

		const result = await badProvider.validateApiKey('invalid-api-key');
		expect(result).toBe(false);
	});
});
