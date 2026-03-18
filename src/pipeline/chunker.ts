import { MAX_CHUNK_SIZE_BYTES } from '../constants';
import { DataError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface AudioChunk {
	data: ArrayBuffer;
	chunkIndex: number;
	startTime: number;
	endTime: number;
	mimeType: string;
	fileExtension: string;
}

export interface ChunkerOptions {
	enableSmartChunking?: boolean;
}

const COMPONENT = 'Chunker';

/** Yield control back to the main thread so the UI doesn't freeze */
function yieldToMain(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}
const SILENCE_SEARCH_WINDOW_SECONDS = 30;
const SILENCE_WINDOW_SIZE_SECONDS = 0.1;
const SILENCE_THRESHOLD = 0.01;
const TARGET_SAMPLE_RATE = 16000;

function detectAudioFormat(data: ArrayBuffer): { mimeType: string; fileExtension: string } {
	const header = new Uint8Array(data, 0, Math.min(12, data.byteLength));

	// Check for ftyp box (MP4/M4A): bytes 4-7 = "ftyp"
	if (header.length >= 8 &&
		header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
		return { mimeType: 'audio/mp4', fileExtension: 'm4a' };
	}
	// Check for RIFF/WAV: bytes 0-3 = "RIFF"
	if (header.length >= 4 &&
		header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
		return { mimeType: 'audio/wav', fileExtension: 'wav' };
	}
	// Check for OGG: bytes 0-3 = "OggS"
	if (header.length >= 4 &&
		header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
		return { mimeType: 'audio/ogg', fileExtension: 'ogg' };
	}
	// Check for MP3: ID3 tag or sync word
	if (header.length >= 3 &&
		((header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || // ID3
		 (header[0] === 0xFF && (header[1]! & 0xE0) === 0xE0))) { // sync
		return { mimeType: 'audio/mpeg', fileExtension: 'mp3' };
	}
	// Default: webm (plugin's recording format)
	return { mimeType: 'audio/webm', fileExtension: 'webm' };
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate <= toRate) return samples;
	const ratio = fromRate / toRate;
	const newLength = Math.floor(samples.length / ratio);
	const result = new Float32Array(newLength);
	for (let i = 0; i < newLength; i++) {
		const srcIndex = Math.floor(i * ratio);
		result[i] = samples[srcIndex] ?? 0;
	}
	return result;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const numSamples = samples.length;
	const buffer = new ArrayBuffer(44 + numSamples * 2);
	const view = new DataView(buffer);

	// RIFF header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + numSamples * 2, true);
	writeString(view, 8, 'WAVE');

	// fmt subchunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * channels * bytesPerSample)
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample

	// data subchunk
	writeString(view, 36, 'data');
	view.setUint32(40, numSamples * 2, true);

	// Write samples (Float32 [-1,1] → Int16)
	for (let i = 0; i < numSamples; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}

	return buffer;
}

export function findSilenceBoundary(
	pcmData: Float32Array,
	sampleRate: number,
	targetTimeSec: number,
	searchWindowSec: number = SILENCE_SEARCH_WINDOW_SECONDS,
): number {
	const windowSizeSamples = Math.floor(sampleRate * SILENCE_WINDOW_SIZE_SECONDS);
	const searchStartSec = Math.max(0, targetTimeSec - searchWindowSec);
	const searchEndSec = Math.min(pcmData.length / sampleRate, targetTimeSec + searchWindowSec);

	const searchStartSample = Math.floor(searchStartSec * sampleRate);
	const searchEndSample = Math.min(
		Math.floor(searchEndSec * sampleRate),
		pcmData.length - windowSizeSamples,
	);

	let minRms = Infinity;
	let minRmsPosition = targetTimeSec;

	for (let pos = searchStartSample; pos <= searchEndSample; pos += windowSizeSamples) {
		let sumSquared = 0;
		for (let j = 0; j < windowSizeSamples; j++) {
			const sample = pcmData[pos + j] ?? 0;
			sumSquared += sample * sample;
		}
		const rms = Math.sqrt(sumSquared / windowSizeSamples);

		if (rms < minRms) {
			minRms = rms;
			minRmsPosition = (pos + windowSizeSamples / 2) / sampleRate;
		}
	}

	if (minRms < SILENCE_THRESHOLD) {
		logger.debug(COMPONENT, 'Found silence boundary', {
			targetTime: targetTimeSec,
			silenceAt: minRmsPosition,
			rms: minRms,
		});
		return minRmsPosition;
	}

	logger.debug(COMPONENT, 'No silence found, using exact boundary', {
		targetTime: targetTimeSec,
		minRms,
	});
	return targetTimeSec;
}

export async function chunkAudio(
	audio: ArrayBuffer,
	options?: ChunkerOptions,
): Promise<AudioChunk[]> {
	const enableSmartChunking = options?.enableSmartChunking ?? false;

	// Size-based threshold: skip PCM decoding entirely for files under 25MB
	if (audio.byteLength <= MAX_CHUNK_SIZE_BYTES) {
		logger.info(COMPONENT, 'Audio under size limit, skipping decode', {
			sizeBytes: audio.byteLength,
			maxBytes: MAX_CHUNK_SIZE_BYTES,
		});
		const { mimeType, fileExtension } = detectAudioFormat(audio);
		return [
			{
				data: audio,
				chunkIndex: 0,
				startTime: 0,
				endTime: 0,
				mimeType,
				fileExtension,
			},
		];
	}

	// File exceeds 25MB — must decode to split
	let audioBuffer: AudioBuffer;
	try {
		const ctx = new OfflineAudioContext(1, 1, 44100);
		audioBuffer = await ctx.decodeAudioData(audio.slice(0));
	} catch (err) {
		throw new DataError(
			`Failed to decode audio: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const duration = audioBuffer.duration;
	const sampleRate = audioBuffer.sampleRate;
	const outputSampleRate = sampleRate > TARGET_SAMPLE_RATE ? TARGET_SAMPLE_RATE : sampleRate;

	// Calculate max chunk duration targeting <25MB per WAV chunk
	// WAV bytes = 44 (header) + duration * sampleRate * 2 (16-bit mono)
	const wavBytesPerSecond = outputSampleRate * 2;
	const maxDuration = Math.floor((MAX_CHUNK_SIZE_BYTES - 44) / wavBytesPerSecond);

	logger.info(COMPONENT, 'Audio loaded, splitting required', {
		duration,
		sampleRate,
		outputSampleRate,
		maxDurationPerChunk: maxDuration,
		sizeBytes: audio.byteLength,
	});

	// Get PCM data for re-encoding (and optionally silence detection)
	const pcmData = audioBuffer.getChannelData(0);

	// Calculate split points
	const chunkCount = Math.ceil(duration / maxDuration);
	const splitPoints: number[] = [0];

	for (let i = 1; i < chunkCount; i++) {
		const targetTime = i * maxDuration;
		if (enableSmartChunking) {
			const boundary = findSilenceBoundary(pcmData, sampleRate, targetTime);
			splitPoints.push(boundary);
		} else {
			splitPoints.push(targetTime);
		}
		await yieldToMain();
	}
	splitPoints.push(duration);

	logger.info(COMPONENT, 'Splitting audio', { chunkCount, splitPoints, enableSmartChunking });

	// Create chunks — yield between each to keep UI responsive
	const chunks: AudioChunk[] = [];
	for (let i = 0; i < chunkCount; i++) {
		const startTime = splitPoints[i]!;
		const endTime = splitPoints[i + 1]!;
		const startSample = Math.floor(startTime * sampleRate);
		const endSample = Math.min(Math.floor(endTime * sampleRate), pcmData.length);

		const chunkPcm = pcmData.slice(startSample, endSample);
		const downsampledPcm = downsample(chunkPcm, sampleRate, outputSampleRate);
		const wavData = encodeWav(downsampledPcm, outputSampleRate);

		chunks.push({
			data: wavData,
			chunkIndex: i,
			startTime,
			endTime,
			mimeType: 'audio/wav',
			fileExtension: 'wav',
		});

		logger.debug(COMPONENT, 'Chunk created', {
			chunkIndex: i,
			startTime,
			endTime,
			samples: downsampledPcm.length,
			sizeBytes: wavData.byteLength,
		});

		await yieldToMain();
	}

	return chunks;
}
