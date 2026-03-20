import { classifyClovaError, classifyClovaResultError } from '../clova-error-utils';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment } from '../types';

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

export class ClovaSpeechSTTProvider implements STTProvider {
	readonly name = 'clova';

	private invokeUrl = '';
	private secretKey = '';

	setCredentials(invokeUrl: string, secretKey: string): void {
		this.invokeUrl = invokeUrl;
		this.secretKey = secretKey;
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const language = options.language ?? 'ko-KR';
		const filename = options.audioFileName ?? 'audio.webm';
		const contentType = options.audioMimeType ?? 'audio/webm';

		logger.debug(COMPONENT, 'Starting transcription', {
			model: options.model,
			language,
			audioSize: audio.byteLength,
		});

		const formData = new FormData();
		formData.append('media', new Blob([audio], { type: contentType }), filename);
		formData.append('params', JSON.stringify({
			language,
			completion: 'sync',
			fullText: true,
			diarization: { enable: true },
			wordAlignment: true,
			noiseFiltering: true,
		}));

		let response: Response;
		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			response = await fetch(`${this.invokeUrl}/recognizer/upload`, {
				method: 'POST',
				headers: { 'X-CLOVASPEECH-API-KEY': this.secretKey },
				body: formData,
			});
		} catch (err) {
			logger.error(COMPONENT, 'Transcription network error', {
				error: err instanceof Error ? err.message : String(err),
			});
			classifyClovaError(err);
		}

		if (!response.ok) {
			let errorBody: unknown;
			try {
				errorBody = await response.json();
			} catch {
				errorBody = await response.text().catch(() => '');
			}
			logger.error(COMPONENT, 'Transcription failed', {
				status: response.status,
				errorBody,
			});
			classifyClovaError({ status: response.status, message: typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody ? (errorBody as { message: string }).message : '' });
		}

		const json = await response.json() as ClovaApiResponse;

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
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			const response = await fetch(`${this.invokeUrl}/recognizer/upload`, {
				method: 'POST',
				headers: {
					'X-CLOVASPEECH-API-KEY': key,
				},
				body: new FormData(),
			});

			// 401/403 means invalid credentials; any other response means credentials work
			if (response.status === 401 || response.status === 403) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}
}
