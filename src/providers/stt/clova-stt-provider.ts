import { requestUrl } from 'obsidian';
import { classifyClovaError, classifyClovaResultError } from '../clova-error-utils';
import { TransientError, ConfigError, DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment, ProviderCredentials } from '../types';

const COMPONENT = 'ClovaSpeechSTTProvider';

interface ClovaSegment {
	start: number;
	end: number;
	text: string;
	confidence?: number;
	diarization?: { label: string };
	speaker?: { label: string; name: string; edited: boolean };
	words?: [number, number, string][];
}

interface ClovaApiResponse {
	result: string;
	message: string;
	segments: ClovaSegment[];
	text: string;
	speakers?: { label: string; name: string; edited: boolean }[];
}

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'clova-sync', name: 'CLOVA Speech (Sync)', supportsDiarization: true },
];

function buildMultipartBody(
	audio: ArrayBuffer,
	contentType: string,
	filename: string,
	params: object,
): { body: ArrayBuffer; boundary: string } {
	const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
	const encoder = new TextEncoder();

	const mediaHeader = encoder.encode(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
		`Content-Type: ${contentType}\r\n\r\n`,
	);

	const paramsPart = encoder.encode(
		`\r\n--${boundary}\r\n` +
		`Content-Disposition: form-data; name="params"\r\n\r\n` +
		`${JSON.stringify(params)}`,
	);

	const ending = encoder.encode(`\r\n--${boundary}--\r\n`);

	const audioBytes = new Uint8Array(audio);
	const body = new Uint8Array(mediaHeader.length + audioBytes.length + paramsPart.length + ending.length);
	body.set(mediaHeader, 0);
	body.set(audioBytes, mediaHeader.length);
	body.set(paramsPart, mediaHeader.length + audioBytes.length);
	body.set(ending, mediaHeader.length + audioBytes.length + paramsPart.length);

	return { body: body.buffer, boundary };
}

export class ClovaSpeechSTTProvider implements STTProvider {
	readonly name = 'clova';

	private invokeUrl = '';
	private secretKey = '';

	setCredentials(credentials: ProviderCredentials): void {
		if (credentials.type === 'clova') {
			this.invokeUrl = credentials.invokeUrl;
			this.secretKey = credentials.secretKey;
		}
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	getSupportedFormats(): string[] {
		return ['mp3', 'm4a', 'wav', 'flac', 'aac'];
	}

	getMaxDuration(): number | null {
		return 7200;
	}

	getRequiredCredentials(): string[] {
		return ['invokeUrl', 'secretKey'];
	}

	mapLanguageCode(language: string): string | undefined {
		const mapping: Record<string, string> = {
			'ko': 'ko-KR',
			'en': 'en',
			'ja': 'ja',
			'zh': 'zh-cn',
		};
		if (language === 'auto') return 'ko-KR';
		return mapping[language] ?? language;
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const language = options.language ?? 'ko-KR';
		const filename = options.audioFileName ?? 'audio.wav';
		const contentType = options.audioMimeType ?? 'audio/wav';

		logger.debug(COMPONENT, 'Starting transcription', {
			model: options.model,
			language,
			audioSize: audio.byteLength,
		});

		const params = {
			language,
			completion: 'sync',
			fullText: true,
			diarization: { enable: true },
			wordAlignment: true,
			noiseFiltering: true,
		};

		const { body, boundary } = buildMultipartBody(audio, contentType, filename, params);

		let json: ClovaApiResponse;
		try {
			const response = await requestUrl({
				url: `${this.invokeUrl}/recognizer/upload`,
				method: 'POST',
				contentType: `multipart/form-data; boundary=${boundary}`,
				headers: {
					'X-CLOVASPEECH-API-KEY': this.secretKey,
				},
				body,
				throw: false,
			});

			logger.debug(COMPONENT, 'API response', {
				status: response.status,
				bodyPreview: response.text.substring(0, 500),
			});

			if (response.status >= 400) {
				classifyClovaError({ status: response.status, message: response.text });
			}

			json = response.json as ClovaApiResponse;
		} catch (err) {
			if (err instanceof ConfigError || err instanceof DataError || err instanceof TransientError) throw err;
			logger.error(COMPONENT, 'Transcription error', {
				error: err instanceof Error ? err.message : String(err),
				status: (err as { status?: number }).status,
			});
			classifyClovaError(err);
		}

		if (json.result !== 'COMPLETED') {
			classifyClovaResultError(json.result, json.message);
		}

		const segments: TranscriptionSegment[] = json.segments.map((seg) => {
			const segment: TranscriptionSegment = {
				start: seg.start / 1000,
				end: seg.end / 1000,
				text: seg.text,
			};
			if (seg.speaker?.label) {
				segment.speaker = `Participant ${seg.speaker.label}`;
			}
			return segment;
		});

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
		if (!this.invokeUrl || !key) {
			return false;
		}

		logger.debug(COMPONENT, 'Validating CLOVA Speech credentials');

		try {
			await requestUrl({
				url: `${this.invokeUrl}/recognizer/upload`,
				method: 'POST',
				headers: {
					'X-CLOVASPEECH-API-KEY': key,
				},
				body: '',
			});
			// Any non-error response means credentials are valid
			return true;
		} catch (err) {
			const status = (err as { status?: number }).status;
			// 401/403 means invalid credentials
			if (status === 401 || status === 403) {
				return false;
			}
			// Other HTTP errors (400, 500, etc.) mean credentials worked but request was bad — that's fine for validation
			if (status) {
				return true;
			}
			// Network error
			return false;
		}
	}
}
