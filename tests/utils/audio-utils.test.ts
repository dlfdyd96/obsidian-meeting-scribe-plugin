import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateAudioDuration } from '../../src/utils/audio-utils';

describe('estimateAudioDuration', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('should return duration from decoded audio buffer', async () => {
		const mockAudioBuffer = { duration: 120.5 };
		const mockCtx = {
			decodeAudioData: vi.fn().mockResolvedValue(mockAudioBuffer),
		};
		vi.stubGlobal('OfflineAudioContext', vi.fn().mockReturnValue(mockCtx));

		const result = await estimateAudioDuration(new ArrayBuffer(1024));
		expect(result).toBe(120.5);
		expect(mockCtx.decodeAudioData).toHaveBeenCalledOnce();
	});

	it('should throw DataError when decode fails', async () => {
		const mockCtx = {
			decodeAudioData: vi.fn().mockRejectedValue(new Error('Unsupported format')),
		};
		vi.stubGlobal('OfflineAudioContext', vi.fn().mockReturnValue(mockCtx));

		await expect(estimateAudioDuration(new ArrayBuffer(1024)))
			.rejects.toThrow('Failed to estimate audio duration');
	});
});
