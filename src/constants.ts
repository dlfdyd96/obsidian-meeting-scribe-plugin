export const PLUGIN_ID = 'meeting-scribe';
export const PLUGIN_NAME = 'Meeting Scribe';

export const MAX_RETRY_COUNT = 3;
export const RETRY_BASE_DELAY_MS = 1000;

export const MAX_CHUNK_SIZE_BYTES = 25 * 1024 * 1024;
export const DIARIZE_MAX_DURATION_SECONDS = 1400;

export const SUPPORTED_AUDIO_FORMATS = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga'] as const;

/** Provider+model duration limits in seconds. Absent keys have no limit. */
export const PROVIDER_MAX_DURATION: Record<string, number> = {
	'openai:gpt-4o-transcribe-diarize': 1400,       // ~23 min
	'clova:clova-sync': 7200,                         // 2 hours
	'google:chirp_3': 28800,                         // 8 hours
	'google:chirp_2': 28800,                         // 8 hours
};

/** Returns max duration in seconds for a provider:model pair, or null if no limit. */
export function getMaxDuration(provider: string, model: string): number | null {
	return PROVIDER_MAX_DURATION[`${provider}:${model}`] ?? null;
}

export const NOTICE_SUCCESS_TIMEOUT_MS = 5000;
export const NOTICE_RETRY_TIMEOUT_MS = 2000;
export const NOTICE_PERSISTENT_TIMEOUT = 0;

export const TEST_RECORDING_DURATION_MS = 5000;
export const NOTICE_WELCOME_TIMEOUT_MS = 5000;
