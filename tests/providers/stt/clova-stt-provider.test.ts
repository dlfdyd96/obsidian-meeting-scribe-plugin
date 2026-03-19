import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClovaSpeechSTTProvider } from '../../../src/providers/stt/clova-stt-provider';

describe('ClovaSpeechSTTProvider', () => {
	let provider: ClovaSpeechSTTProvider;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		provider = new ClovaSpeechSTTProvider();
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
		it('should throw ConfigError (not yet implemented)', async () => {
			await expect(provider.transcribe(new ArrayBuffer(10), { model: 'clova-sync' }))
				.rejects.toThrow('not yet implemented');
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
