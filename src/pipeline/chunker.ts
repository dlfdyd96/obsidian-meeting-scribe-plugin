import { DEFAULT_CHUNK_DURATION_SECONDS } from '../constants';
import { DataError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface AudioChunk {
	data: ArrayBuffer;
	chunkIndex: number;
	startTime: number;
	endTime: number;
}

export interface ChunkerOptions {
	maxChunkDurationSeconds?: number;
}

const COMPONENT = 'Chunker';
const SILENCE_SEARCH_WINDOW_SECONDS = 30;
const SILENCE_WINDOW_SIZE_SECONDS = 0.1;
const SILENCE_THRESHOLD = 0.01;
const TARGET_SAMPLE_RATE = 16000;

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
	const maxDuration = options?.maxChunkDurationSeconds ?? DEFAULT_CHUNK_DURATION_SECONDS;

	// Decode audio to get duration and PCM data
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

	logger.info(COMPONENT, 'Audio loaded', { duration, sampleRate });

	// No split needed for short audio
	if (duration <= maxDuration) {
		logger.debug(COMPONENT, 'No splitting needed', { duration, maxDuration });
		return [
			{
				data: audio,
				chunkIndex: 0,
				startTime: 0,
				endTime: duration,
			},
		];
	}

	// Get PCM data for silence detection and re-encoding
	const pcmData = audioBuffer.getChannelData(0);

	// Calculate split points
	const chunkCount = Math.ceil(duration / maxDuration);
	const splitPoints: number[] = [0];

	for (let i = 1; i < chunkCount; i++) {
		const targetTime = i * maxDuration;
		const boundary = findSilenceBoundary(pcmData, sampleRate, targetTime);
		splitPoints.push(boundary);
	}
	splitPoints.push(duration);

	logger.info(COMPONENT, 'Splitting audio', { chunkCount, splitPoints });

	// Determine output sample rate (downsample if needed)
	const outputSampleRate = sampleRate > TARGET_SAMPLE_RATE ? TARGET_SAMPLE_RATE : sampleRate;

	// Create chunks
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
		});

		logger.debug(COMPONENT, 'Chunk created', {
			chunkIndex: i,
			startTime,
			endTime,
			samples: downsampledPcm.length,
			sizeBytes: wavData.byteLength,
		});
	}

	return chunks;
}
