import { DataError } from './errors';

/**
 * Estimates audio duration in seconds using OfflineAudioContext decode.
 * This is a lightweight decode that extracts duration without full re-encoding.
 */
export async function estimateAudioDuration(audio: ArrayBuffer): Promise<number> {
	try {
		const ctx = new OfflineAudioContext(1, 1, 44100);
		const audioBuffer = await ctx.decodeAudioData(audio.slice(0));
		return audioBuffer.duration;
	} catch (err) {
		throw new DataError(
			`Failed to estimate audio duration: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
