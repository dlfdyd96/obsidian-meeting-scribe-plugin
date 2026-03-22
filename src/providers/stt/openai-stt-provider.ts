import { requestUrl } from 'obsidian';
import { classifyOpenAIError } from '../openai-error-utils';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment, ProviderCredentials } from '../types';

const COMPONENT = 'OpenAISTTProvider';
const API_BASE = 'https://api.openai.com/v1';
const TRANSCRIPTION_ENDPOINT = `${API_BASE}/audio/transcriptions`;
const MODELS_ENDPOINT = `${API_BASE}/models`;

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'whisper-1', name: 'Whisper v1', supportsDiarization: false },
	{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe', supportsDiarization: false },
	{ id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe', supportsDiarization: false },
	{ id: 'gpt-4o-transcribe-diarize', name: 'GPT-4o Transcribe (Diarization)', supportsDiarization: true },
];

const DIARIZATION_MODEL = 'gpt-4o-transcribe-diarize';
const WHISPER_MODEL = 'whisper-1';

interface SimpleJsonApiResponse {
	text: string;
}

interface VerboseJsonApiResponse {
	text: string;
	language: string;
	segments: { start: number; end: number; text: string }[];
}

interface DiarizedJsonApiResponse {
	text: string;
	segments: { start: number; end: number; text: string; speaker: string }[];
}

export class OpenAISTTProvider implements STTProvider {
	readonly name = 'openai';

	private apiKey = '';

	setCredentials(credentials: ProviderCredentials): void {
		if (credentials.type === 'api-key') {
			this.apiKey = credentials.apiKey;
		}
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	getSupportedFormats(): string[] {
		return ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga'];
	}

	getMaxDuration(): number | null {
		return null;
	}

	getRequiredCredentials(): string[] {
		return ['apiKey'];
	}

	mapLanguageCode(language: string): string | undefined {
		if (language === 'auto') return undefined;
		return language;
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const isDiarization = options.model === DIARIZATION_MODEL;
		logger.debug(COMPONENT, 'Starting transcription', {
			model: options.model,
			isDiarization,
			audioSize: audio.byteLength,
		});

		const isWhisper = options.model === WHISPER_MODEL;
		const filename = options.audioFileName ?? 'audio.webm';
		const contentType = options.audioMimeType ?? 'audio/webm';

		const formData = new FormData();
		formData.append('model', options.model);
		formData.append('file', new Blob([audio], { type: contentType }), filename);

		if (isDiarization) {
			formData.append('response_format', 'diarized_json');
			formData.append('chunking_strategy', 'auto');
		} else if (isWhisper) {
			formData.append('response_format', 'verbose_json');
			formData.append('timestamp_granularities[]', 'segment');
		} else {
			formData.append('response_format', 'json');
		}

		if (options.language) {
			formData.append('language', options.language);
		}

		let response: Response;
		try {
			response = await fetch(TRANSCRIPTION_ENDPOINT, {
				method: 'POST',
				headers: { 'Authorization': `Bearer ${this.apiKey}` },
				body: formData,
			});
		} catch (err) {
			logger.error(COMPONENT, 'Transcription network error', {
				model: options.model,
				error: err instanceof Error ? err.message : String(err),
			});
			classifyOpenAIError(err);
		}

		if (!response.ok) {
			let errorBody: unknown;
			try {
				errorBody = await response.json();
			} catch {
				errorBody = await response.text().catch(() => '');
			}
			logger.error(COMPONENT, 'Transcription failed', {
				model: options.model,
				status: response.status,
				errorBody,
			});
			classifyOpenAIError({ status: response.status, json: errorBody });
		}

		const json = await response.json() as SimpleJsonApiResponse | VerboseJsonApiResponse | DiarizedJsonApiResponse;

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
		} else if (isWhisper) {
			const verbose = json as VerboseJsonApiResponse;
			segments = verbose.segments.map((seg) => ({
				start: seg.start,
				end: seg.end,
				text: seg.text,
			}));
			language = verbose.language;
		} else {
			const simple = json as SimpleJsonApiResponse;
			segments = [{
				start: 0,
				end: 0,
				text: simple.text,
			}];
			language = options.language ?? 'auto';
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
