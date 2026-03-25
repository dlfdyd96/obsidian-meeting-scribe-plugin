import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataError } from '../../src/utils/errors';
import { logger } from '../../src/utils/logger';
import { MAX_CHUNK_SIZE_BYTES } from '../../src/constants';

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
let mockOfflineAudioContextConstructor: ReturnType<typeof vi.fn>;

function setupOfflineAudioContextMock(audioBuffer: ReturnType<typeof createMockAudioBuffer>): void {
	mockDecodeAudioData = vi.fn().mockResolvedValue(audioBuffer);
	mockOfflineAudioContextConstructor = vi.fn().mockImplementation(() => ({
		decodeAudioData: mockDecodeAudioData,
	}));
	vi.stubGlobal('OfflineAudioContext', mockOfflineAudioContextConstructor);
}

/** Create an ArrayBuffer of a specific size */
function createBufferOfSize(bytes: number): ArrayBuffer {
	return new ArrayBuffer(bytes);
}

describe('Audio Chunker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('chunkAudio — size-based threshold', () => {
		it('should return single chunk for file ≤ 25MB without PCM decoding', async () => {
			mockOfflineAudioContextConstructor = vi.fn();
			vi.stubGlobal('OfflineAudioContext', mockOfflineAudioContextConstructor);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = createBufferOfSize(19 * 1024 * 1024); // 19MB
			const chunks = await chunkAudio(inputAudio);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]!.chunkIndex).toBe(0);
			expect(chunks[0]!.startTime).toBe(0);
			expect(chunks[0]!.endTime).toBe(0);
			expect(chunks[0]!.data).toBe(inputAudio);
			// Default format detection for empty buffer → webm
			expect(chunks[0]!.mimeType).toBe('audio/webm');
			expect(chunks[0]!.fileExtension).toBe('webm');

			// OfflineAudioContext should NOT have been instantiated
			expect(mockOfflineAudioContextConstructor).not.toHaveBeenCalled();
		});

		it('should return single chunk for file exactly at 25MB limit', async () => {
			mockOfflineAudioContextConstructor = vi.fn();
			vi.stubGlobal('OfflineAudioContext', mockOfflineAudioContextConstructor);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = createBufferOfSize(MAX_CHUNK_SIZE_BYTES);
			const chunks = await chunkAudio(inputAudio);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]!.data).toBe(inputAudio);
			expect(mockOfflineAudioContextConstructor).not.toHaveBeenCalled();
		});

		it('should detect m4a format for files with ftyp header', async () => {
			mockOfflineAudioContextConstructor = vi.fn();
			vi.stubGlobal('OfflineAudioContext', mockOfflineAudioContextConstructor);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = createBufferOfSize(1024);
			// Write ftyp header at bytes 4-7
			const view = new Uint8Array(inputAudio);
			view[4] = 0x66; // f
			view[5] = 0x74; // t
			view[6] = 0x79; // y
			view[7] = 0x70; // p

			const chunks = await chunkAudio(inputAudio);
			expect(chunks[0]!.mimeType).toBe('audio/mp4');
			expect(chunks[0]!.fileExtension).toBe('m4a');
		});

		it('should decode and split files > 25MB', { timeout: 15000 }, async () => {
			const sampleRate = 16000;
			const duration = 3600; // 1 hour
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const inputAudio = createBufferOfSize(26 * 1024 * 1024); // 26MB
			const chunks = await chunkAudio(inputAudio);

			expect(chunks.length).toBeGreaterThan(1);
			expect(mockOfflineAudioContextConstructor).toHaveBeenCalled();
			// All split chunks are WAV
			for (const chunk of chunks) {
				expect(chunk.mimeType).toBe('audio/wav');
				expect(chunk.fileExtension).toBe('wav');
			}
		});
	});

	describe('chunkAudio — splitting behavior for large files', () => {
		it('should produce chunks with continuous startTime/endTime (no gaps or overlaps)', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			expect(chunks[0]!.startTime).toBe(0);
			expect(chunks[chunks.length - 1]!.endTime).toBe(duration);
			for (let i = 1; i < chunks.length; i++) {
				expect(chunks[i]!.startTime).toBe(chunks[i - 1]!.endTime);
			}
		});

		it('should split at exact time boundaries when smart chunking is disabled (default)', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createPcmWithSilence(duration, sampleRate, [400, 800]);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			// Without smart chunking, boundaries should be at exact calculated times
			// All chunks except the last should have the same duration (maxDuration)
			const maxDuration = Math.floor((MAX_CHUNK_SIZE_BYTES - 44) / (sampleRate * 2));
			for (let i = 0; i < chunks.length - 1; i++) {
				const chunkDuration = chunks[i]!.endTime - chunks[i]!.startTime;
				expect(chunkDuration).toBe(maxDuration);
			}
		});

		it('should use silence detection when enableSmartChunking is true', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			// Place silence near split boundaries
			const maxDuration = Math.floor((MAX_CHUNK_SIZE_BYTES - 44) / (sampleRate * 2));
			const silenceAt = [maxDuration - 5]; // 5 seconds before first split
			const pcm = createPcmWithSilence(duration, sampleRate, silenceAt);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024), {
				enableSmartChunking: true,
			});

			// First chunk should NOT end at exact maxDuration — shifted by silence
			expect(chunks[0]!.endTime).not.toBe(maxDuration);
			expect(chunks[0]!.endTime).toBeGreaterThan(maxDuration - 10);
			expect(chunks[0]!.endTime).toBeLessThan(maxDuration + 10);
		});

		it('should fall back to exact time when smart chunking finds no silence', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024), {
				enableSmartChunking: true,
			});

			const maxDuration = Math.floor((MAX_CHUNK_SIZE_BYTES - 44) / (sampleRate * 2));
			expect(chunks[0]!.endTime).toBe(maxDuration);
		});

		it('should throw DataError for undecodable audio > 25MB', async () => {
			mockDecodeAudioData = vi.fn().mockRejectedValue(new Error('Unable to decode audio data'));
			vi.stubGlobal(
				'OfflineAudioContext',
				vi.fn().mockImplementation(() => ({
					decodeAudioData: mockDecodeAudioData,
				})),
			);

			const { chunkAudio } = await import('../../src/pipeline/chunker');

			await expect(chunkAudio(createBufferOfSize(26 * 1024 * 1024))).rejects.toThrow(DataError);
			await expect(chunkAudio(createBufferOfSize(26 * 1024 * 1024))).rejects.toThrow('Failed to decode audio');
		});
	});

	describe('chunkAudio — WAV encoding for split chunks', () => {
		it('should set WAV mimeType and fileExtension for split chunks', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			expect(chunks.length).toBeGreaterThan(1);
			for (const chunk of chunks) {
				expect(chunk.mimeType).toBe('audio/wav');
				expect(chunk.fileExtension).toBe('wav');
			}
		});

		it('should produce valid WAV headers in chunked output', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			for (const chunk of chunks) {
				const view = new DataView(chunk.data);
				expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
				expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
				expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ');
				expect(view.getUint16(20, true)).toBe(1); // PCM
				expect(view.getUint16(22, true)).toBe(1); // mono
				expect(view.getUint32(24, true)).toBe(sampleRate);
				expect(view.getUint16(34, true)).toBe(16); // 16-bit
				expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data');
				const dataSize = view.getUint32(40, true);
				expect(chunk.data.byteLength).toBe(44 + dataSize);
			}
		});

		it('should preserve original sample rate in WAV chunks', async () => {
			const sampleRate = 44100;
			const duration = 120;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			for (const chunk of chunks) {
				const view = new DataView(chunk.data);
				expect(view.getUint32(24, true)).toBe(44100);
			}
		});

		it('should ensure each WAV chunk is ≤ 25MB', async () => {
			const sampleRate = 16000;
			const duration = 3600;
			const pcm = createUniformNoisePcm(duration, sampleRate);
			const mockBuffer = createMockAudioBuffer({ duration, sampleRate, channelData: pcm });
			setupOfflineAudioContextMock(mockBuffer);

			const { chunkAudio } = await import('../../src/pipeline/chunker');
			const chunks = await chunkAudio(createBufferOfSize(26 * 1024 * 1024));

			for (const chunk of chunks) {
				expect(chunk.data.byteLength).toBeLessThanOrEqual(MAX_CHUNK_SIZE_BYTES);
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
			const pcm = createPcmWithSilence(duration, sampleRate, [580, 610]);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			const boundary = findSilenceBoundary(pcm, sampleRate, 600);

			expect(boundary).toBeGreaterThan(579);
			expect(boundary).toBeLessThan(611);
		});

		it('should clamp search window to audio boundaries', async () => {
			const sampleRate = 16000;
			const duration = 50;
			const pcm = createPcmWithSilence(duration, sampleRate, [10]);

			const { findSilenceBoundary } = await import('../../src/pipeline/chunker');
			const boundary = findSilenceBoundary(pcm, sampleRate, 20);

			expect(boundary).toBeGreaterThan(9);
			expect(boundary).toBeLessThan(11);
		});
	});
});
