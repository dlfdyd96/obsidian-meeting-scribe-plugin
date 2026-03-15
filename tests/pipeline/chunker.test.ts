import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataError } from '../../src/utils/errors';
import { logger } from '../../src/utils/logger';

// Mock logger
vi.spyOn(logger, 'debug').mockImplementation(() => {});
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});

// --- Mock AudioBuffer and OfflineAudioContext ---

interface MockAudioBufferConfig {
	duration: number;
	sampleRate: number;
	channelData: Float32Array;
}

function createMockAudioBuffer(config: MockAudioBufferConfig) {
	return {
		duration: config.duration,
		sampleRate: config.sampleRate,
		numberOfChannels: 1,
		length: config.channelData.length,
		getChannelData: vi.fn().mockReturnValue(config.channelData),
	};
}

function createPcmWithSilence(
	durationSec: number,
	sampleRate: number,
	silenceAt: number[],
): Float32Array {
	const data = new Float32Array(Math.floor(durationSec * sampleRate));
	// Fill with moderate noise
	for (let i = 0; i < data.length; i++) {
		// Use a deterministic pattern instead of random for reproducibility
		data[i] = Math.sin(i * 0.1) * 0.3;
	}
	// Insert silence windows (500ms each)
	for (const t of silenceAt) {
		const start = Math.floor(t * sampleRate);
		const end = Math.floor((t + 0.5) * sampleRate);
		for (let i = start; i < end && i < data.length; i++) {
			data[i] = 0;
		}
	}
	return data;
}

function createUniformNoisePcm(durationSec: number, sampleRate: number): Float32Array {
	const data = new Float32Array(Math.floor(durationSec * sampleRate));
	for (let i = 0; i < data.length; i++) {
		data[i] = Math.sin(i * 0.1) * 0.3; // Constant amplitude — no silence
	}
	return data;
}

let mockDecodeAudioData: ReturnType<typeof vi.fn>;

function setupOfflineAudioContextMock(audioBuffer: ReturnType<typeof createMockAudioBuffer>): void {
	mockDecodeAudioData = vi.fn().mockResolvedValue(audioBuffer);
	vi.stubGlobal(
		'OfflineAudioContext',
		vi.fn().mockImplementation(() => ({
			decodeAudioData: mockDecodeAudioData,
		})),
	);
}

describe('Audio Chunker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('chunkAudio', () => {
		it('should return single chunk for short audio (≤ 600s)', async () => {
			const sampleRate = 16000;
			const duration = 300; // 5 minutes
			const pcm = new Float32Array(duration * sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = new ArrayBuffer(1024);
			const chunks = await chunkAudio(inputAudio);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]!.chunkIndex).toBe(0);
			expect(chunks[0]!.startTime).toBe(0);
			expect(chunks[0]!.endTime).toBe(300);
			// For short audio, original ArrayBuffer is returned as-is
			expect(chunks[0]!.data).toBe(inputAudio);
		});

		it('should return single chunk for audio exactly at limit (600s)', async () => {
			const sampleRate = 16000;
			const duration = 600;
			const pcm = new Float32Array(duration * sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = new ArrayBuffer(1024);
			const chunks = await chunkAudio(inputAudio);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]!.data).toBe(inputAudio);
		});

		it('should split long audio (1500s) into 3 chunks', async () => {
			const sampleRate = 16000;
			const duration = 1500; // 25 minutes
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			expect(chunks).toHaveLength(3);
			expect(chunks[0]!.chunkIndex).toBe(0);
			expect(chunks[1]!.chunkIndex).toBe(1);
			expect(chunks[2]!.chunkIndex).toBe(2);
		});

		it('should produce chunks with continuous startTime/endTime (no gaps or overlaps)', async () => {
			const sampleRate = 16000;
			const duration = 1500;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			// First chunk starts at 0
			expect(chunks[0]!.startTime).toBe(0);
			// Last chunk ends at duration
			expect(chunks[chunks.length - 1]!.endTime).toBe(duration);
			// Each chunk's startTime matches previous chunk's endTime
			for (let i = 1; i < chunks.length; i++) {
				expect(chunks[i]!.startTime).toBe(chunks[i - 1]!.endTime);
			}
		});

		it('should align chunk boundaries with silence windows', async () => {
			const sampleRate = 16000;
			const duration = 1500;
			// Place silence near the 600s and 1200s target split points
			const pcm = createPcmWithSilence(duration, sampleRate, [595, 1190]);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			expect(chunks).toHaveLength(3);
			// First split should be near 595s (silence region), not exactly at 600s
			expect(chunks[0]!.endTime).toBeGreaterThan(594);
			expect(chunks[0]!.endTime).toBeLessThan(596);
			// Second split should be near 1190s
			expect(chunks[1]!.endTime).toBeGreaterThan(1189);
			expect(chunks[1]!.endTime).toBeLessThan(1191);
		});

		it('should fall back to exact time boundary when no silence found', async () => {
			const sampleRate = 16000;
			const duration = 1500;
			// Uniform noise, no silence at all
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			expect(chunks).toHaveLength(3);
			// Without silence, should split at exact 600s and 1200s
			expect(chunks[0]!.endTime).toBe(600);
			expect(chunks[1]!.endTime).toBe(1200);
		});

		it('should respect custom maxChunkDurationSeconds', async () => {
			const sampleRate = 16000;
			const duration = 600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024), {
				maxChunkDurationSeconds: 200,
			});

			expect(chunks).toHaveLength(3);
		});

		it('should throw DataError for undecodable audio', async () => {
			mockDecodeAudioData = vi.fn().mockRejectedValue(new Error('Unable to decode audio data'));
			vi.stubGlobal(
				'OfflineAudioContext',
				vi.fn().mockImplementation(() => ({
					decodeAudioData: mockDecodeAudioData,
				})),
			);

			const { chunkAudio } = await import('../../src/pipeline/chunker');

			await expect(chunkAudio(new ArrayBuffer(0))).rejects.toThrow(DataError);
			await expect(chunkAudio(new ArrayBuffer(0))).rejects.toThrow('Failed to decode audio');
		});

		it('should produce valid WAV headers in chunked output', async () => {
			const sampleRate = 16000;
			const duration = 1500;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			for (const chunk of chunks) {
				const view = new DataView(chunk.data);
				// RIFF magic
				expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
				// WAVE format
				expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
				// fmt subchunk
				expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ');
				// PCM format (1)
				expect(view.getUint16(20, true)).toBe(1);
				// Mono (1 channel)
				expect(view.getUint16(22, true)).toBe(1);
				// Sample rate
				expect(view.getUint32(24, true)).toBe(sampleRate);
				// 16 bits per sample
				expect(view.getUint16(34, true)).toBe(16);
				// data subchunk
				expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data');
				// data size matches file size - 44
				const dataSize = view.getUint32(40, true);
				expect(chunk.data.byteLength).toBe(44 + dataSize);
			}
		});

		it('should downsample from higher sample rates to 16kHz', async () => {
			const sampleRate = 44100;
			const duration = 1500;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			for (const chunk of chunks) {
				const view = new DataView(chunk.data);
				// Should be downsampled to 16kHz
				expect(view.getUint32(24, true)).toBe(16000);
				// Each chunk's data size should reflect ~10min @ 16kHz 16-bit mono
				// ≈ 600s * 16000 * 2 = 19,200,000 bytes (under 25 MB limit)
				const dataSize = view.getUint32(40, true);
				expect(dataSize).toBeLessThan(25 * 1024 * 1024);
			}
		});

		it('should not downsample if source rate is ≤ 16kHz', async () => {
			const sampleRate = 8000;
			const duration = 1500;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(new ArrayBuffer(1024));

			for (const chunk of chunks) {
				const view = new DataView(chunk.data);
				// Should keep original 8kHz
				expect(view.getUint32(24, true)).toBe(8000);
			}
		});
	});

	describe('findSilenceBoundary', () => {
		it('should return silence position when silence exists near target', async () => {
			const sampleRate = 16000;
			const duration = 1200;
			const pcm = createPcmWithSilence(duration, sampleRate, [595]);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			const boundary = findSilenceBoundary(pcm, sampleRate, 600);

			// Should find the silence at ~595s
			expect(boundary).toBeGreaterThan(594);
			expect(boundary).toBeLessThan(596);
		});

		it('should return exact target time when no silence found', async () => {
			const sampleRate = 16000;
			const duration = 1200;
			const pcm = createUniformNoisePcm(duration, sampleRate);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			const boundary = findSilenceBoundary(pcm, sampleRate, 600);

			expect(boundary).toBe(600);
		});

		it('should prefer silence closest to minimum RMS within search window', async () => {
			const sampleRate = 16000;
			const duration = 1200;
			// Two silence regions: one at 580s (quieter) and one at 610s
			const pcm = createPcmWithSilence(duration, sampleRate, [580, 610]);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			const boundary = findSilenceBoundary(pcm, sampleRate, 600);

			// Should pick the one with lowest RMS (both are 0, so either is valid)
			expect(boundary).toBeGreaterThan(579);
			expect(boundary).toBeLessThan(611);
		});

		it('should clamp search window to audio boundaries', async () => {
			const sampleRate = 16000;
			const duration = 50;
			const pcm = createPcmWithSilence(duration, sampleRate, [10]);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			// Target at 20s with 30s window — window start would be -10, clamped to 0
			const boundary = findSilenceBoundary(pcm, sampleRate, 20);

			expect(boundary).toBeGreaterThan(9);
			expect(boundary).toBeLessThan(11);
		});
	});
});
