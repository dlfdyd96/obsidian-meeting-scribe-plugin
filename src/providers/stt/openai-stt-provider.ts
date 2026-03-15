import { requestUrl } from 'obsidian';
import { TransientError, ConfigError, DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment } from '../types';

const COMPONENT = 'OpenAISTTProvider';
const API_BASE = 'https://api.openai.com/v1';
const TRANSCRIPTION_ENDPOINT = `${API_BASE}/audio/transcriptions`;
const MODELS_ENDPOINT = `${API_BASE}/models`;

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe', supportsDiarization: false },
	{ id: 'gpt-4o-transcribe-diarize', name: 'GPT-4o Transcribe (Diarization)', supportsDiarization: true },
];

const DIARIZATION_MODEL = 'gpt-4o-transcribe-diarize';

interface VerboseJsonApiResponse {
	text: string;
	language: string;
	segments: { start: number; end: number; text: string }[];
}

interface DiarizedJsonApiResponse {
	text: string;
	segments: { start: number; end: number; text: string; speaker: string }[];
}

function concatenateArrayBuffers(arrays: Uint8Array[]): ArrayBuffer {
	let totalLength = 0;
	for (const arr of arrays) {
		totalLength += arr.byteLength;
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.byteLength;
	}
	return result.buffer;
}

function buildMultipartBody(
	fields: Record<string, string>,
	fileField: { name: string; filename: string; data: ArrayBuffer; contentType: string },
	boundary: string,
): ArrayBuffer {
	const parts: Uint8Array[] = [];
	const encoder = new TextEncoder();

	for (const [name, value] of Object.entries(fields)) {
		const header = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
		parts.push(encoder.encode(header));
	}

	const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`;
	parts.push(encoder.encode(fileHeader));
	parts.push(new Uint8Array(fileField.data));
	parts.push(encoder.encode('\r\n'));

	parts.push(encoder.encode(`--${boundary}--\r\n`));

	return concatenateArrayBuffers(parts);
}

function classifyError(err: unknown): never {
	const status = (err as { status?: number }).status;
	const errorJson = (err as { json?: { error?: { message?: string } } }).json;
	const errorMessage = errorJson?.error?.message ?? '';

	if (status === 401) {
		throw new ConfigError('Invalid OpenAI API key. Please check your API key in settings.');
	}
	if (status === 403) {
		throw new ConfigError('OpenAI API access denied. Your region or account may not be supported.');
	}
	if (status === 400) {
		throw new DataError(`Invalid transcription request: ${errorMessage}`);
	}
	if (status === 413) {
		throw new DataError('Audio file too large. Maximum size is 25 MB per request.');
	}
	if (status === 429) {
		if (errorMessage.includes('insufficient_quota')) {
			throw new ConfigError('OpenAI API quota exceeded. Please check your billing settings.');
		}
		throw new TransientError('OpenAI API rate limit reached. Will retry shortly.');
	}
	if (status === 500 || status === 503) {
		throw new TransientError('OpenAI API server error. Will retry shortly.');
	}

	// Network errors (no status code)
	throw new TransientError(`Network error communicating with OpenAI: ${err instanceof Error ? err.message : String(err)}`);
}

export class OpenAISTTProvider implements STTProvider {
	readonly name = 'openai';

	private apiKey = '';

	setApiKey(key: string): void {
		this.apiKey = key;
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const isDiarization = options.model === DIARIZATION_MODEL;
		logger.debug(COMPONENT, 'Starting transcription', {
			model: options.model,
			isDiarization,
			audioSize: audio.byteLength,
		});

		const fields: Record<string, string> = {
			model: options.model,
		};

		if (isDiarization) {
			fields['response_format'] = 'diarized_json';
			fields['chunking_strategy'] = 'auto';
		} else {
			fields['response_format'] = 'verbose_json';
			fields['timestamp_granularities[]'] = 'segment';
		}

		if (options.language) {
			fields['language'] = options.language;
		}

		const boundary = `----FormBoundary${Date.now()}`;
		const body = buildMultipartBody(
			fields,
			{ name: 'file', filename: 'audio.webm', data: audio, contentType: 'audio/webm' },
			boundary,
		);

		try {
			const response = await requestUrl({
				url: TRANSCRIPTION_ENDPOINT,
				method: 'POST',
				contentType: `multipart/form-data; boundary=${boundary}`,
				body,
				headers: {
					'Authorization': `Bearer ${this.apiKey}`,
				},
			});

			const json = response.json as VerboseJsonApiResponse | DiarizedJsonApiResponse;

			let segments: TranscriptionSegment[];
			let language: string;

			if (isDiarization) {
				const diarized = json as DiarizedJsonApiResponse;
				segments = diarized.segments.map((seg) => ({
					start: seg.start,
					end: seg.end,
					text: seg.text,
					speaker: seg.speaker,
				}));
				language = options.language ?? 'auto';
			} else {
				const verbose = json as VerboseJsonApiResponse;
				segments = verbose.segments.map((seg) => ({
					start: seg.start,
					end: seg.end,
					text: seg.text,
				}));
				language = verbose.language;
			}

			const result: TranscriptionResult = {
				version: 1,
				audioFile: '',
				provider: this.name,
				model: options.model,
				language,
				segments,
				fullText: json.text,
				createdAt: new Date().toISOString(),
			};

			logger.debug(COMPONENT, 'Transcription complete', {
				segmentCount: segments.length,
				textLength: json.text.length,
			});

			return result;
		} catch (err) {
			logger.error(COMPONENT, 'Transcription failed', {
				model: options.model,
				error: err instanceof Error ? err.message : String(err),
			});
			classifyError(err);
		}
	}

	async validateApiKey(key: string): Promise<boolean> {
		logger.debug(COMPONENT, 'Validating API key');
		try {
			await requestUrl({
				url: MODELS_ENDPOINT,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${key}`,
				},
			});
			return true;
		} catch {
			return false;
		}
	}
}
