import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSTTProvider } from '../../../src/providers/stt/google-stt-provider';

describe('GoogleSTTProvider', () => {
	let provider: GoogleSTTProvider;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		provider = new GoogleSTTProvider();
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
		it('should throw ConfigError (not yet implemented)', async () => {
			await expect(provider.transcribe(new ArrayBuffer(10), { model: 'chirp_3' }))
				.rejects.toThrow('not yet implemented');
		});
	});

	describe('validateApiKey', () => {
		it('should return false when projectId is empty', async () => {
			provider.setCredentials('', 'api-key', 'global');
			const result = await provider.validateApiKey('api-key');
			expect(result).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('should return false when key is empty', async () => {
			provider.setCredentials('my-project', '', 'global');
			const result = await provider.validateApiKey('');
			expect(result).toBe(false);
		});

		it('should return false for 401 response', async () => {
			provider.setCredentials('my-project', 'bad-key', 'global');
			fetchSpy.mockResolvedValue({ status: 401 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return false for 403 response', async () => {
			provider.setCredentials('my-project', 'bad-key', 'global');
			fetchSpy.mockResolvedValue({ status: 403 } as Response);
			const result = await provider.validateApiKey('bad-key');
			expect(result).toBe(false);
		});

		it('should return true for 200 response', async () => {
			provider.setCredentials('my-project', 'good-key', 'global');
			fetchSpy.mockResolvedValue({ status: 200 } as Response);
			const result = await provider.validateApiKey('good-key');
			expect(result).toBe(true);
		});

		it('should return false on network error', async () => {
			provider.setCredentials('my-project', 'key', 'global');
			fetchSpy.mockRejectedValue(new Error('Network error'));
			const result = await provider.validateApiKey('key');
			expect(result).toBe(false);
		});

		it('should use correct Google Cloud STT API URL', async () => {
			provider.setCredentials('my-project', 'my-key', 'us-central1');
			fetchSpy.mockResolvedValue({ status: 200 } as Response);
			await provider.validateApiKey('my-key');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://speech.googleapis.com/v2/projects/my-project/locations/us-central1/recognizers',
				expect.objectContaining({
					method: 'GET',
					headers: { 'Authorization': 'Bearer my-key' },
				}),
			);
		});
	});
});
