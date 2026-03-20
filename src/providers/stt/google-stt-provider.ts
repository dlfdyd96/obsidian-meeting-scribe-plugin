import { classifyGoogleCloudError, classifyGoogleCloudOperationError } from '../google-cloud-error-utils';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment } from '../types';

const COMPONENT = 'GoogleSTTProvider';

interface GoogleWordInfo {
	word: string;
	startOffset?: string;
	endOffset?: string;
	speakerLabel?: string;
	confidence?: number;
}

interface GoogleRecognizeResult {
	alternatives?: Array<{
		transcript?: string;
		confidence?: number;
		words?: GoogleWordInfo[];
	}>;
	resultEndOffset?: string;
	languageCode?: string;
}

interface GoogleRecognizeResponse {
	results?: GoogleRecognizeResult[];
	error?: { code: number; message: string };
}

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'chirp_3', name: 'Chirp 3 (Recommended)', supportsDiarization: true },
	{ id: 'chirp_2', name: 'Chirp 2', supportsDiarization: true },
];

function parseTimestamp(offset: string | undefined): number {
	if (!offset) return 0;
	const stripped = offset.endsWith('s') ? offset.slice(0, -1) : offset;
	const value = parseFloat(stripped);
	return isNaN(value) ? 0 : value;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 8192;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

function mergeWordsIntoSegments(words: GoogleWordInfo[]): TranscriptionSegment[] {
	if (words.length === 0) return [];

	const segments: TranscriptionSegment[] = [];
	let currentSpeaker = words[0].speakerLabel;
	let currentTexts: string[] = [words[0].word];
	let currentStart = parseTimestamp(words[0].startOffset);
	let currentEnd = parseTimestamp(words[0].endOffset);

	for (let i = 1; i < words.length; i++) {
		const word = words[i];
		if (word.speakerLabel === currentSpeaker) {
			currentTexts.push(word.word);
			currentEnd = parseTimestamp(word.endOffset);
		} else {
			const segment: TranscriptionSegment = {
				start: currentStart,
				end: currentEnd,
				text: currentTexts.join(' '),
			};
			if (currentSpeaker) {
				segment.speaker = `Participant ${currentSpeaker}`;
			}
			segments.push(segment);

			currentSpeaker = word.speakerLabel;
			currentTexts = [word.word];
			currentStart = parseTimestamp(word.startOffset);
			currentEnd = parseTimestamp(word.endOffset);
		}
	}

	const lastSegment: TranscriptionSegment = {
		start: currentStart,
		end: currentEnd,
		text: currentTexts.join(' '),
	};
	if (currentSpeaker) {
		lastSegment.speaker = `Participant ${currentSpeaker}`;
	}
	segments.push(lastSegment);

	return segments;
}

export class GoogleSTTProvider implements STTProvider {
	readonly name = 'google';

	private projectId = '';
	private apiKey = '';
	private location = 'global';

	setCredentials(projectId: string, apiKey: string, location: string): void {
		this.projectId = projectId;
		this.apiKey = apiKey;
		this.location = location;
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const model = options.model || 'chirp_3';
		const languageCode = options.language ?? 'en-US';

		logger.debug(COMPONENT, 'Starting transcription', {
			model,
			language: languageCode,
			audioSize: audio.byteLength,
		});

		const base64Content = arrayBufferToBase64(audio);

		const requestBody = {
			config: {
				autoDecodingConfig: {},
				model,
				languageCodes: [languageCode],
				features: {
					enableWordTimeOffsets: true,
					diarizationConfig: {},
				},
			},
			content: base64Content,
		};

		const url = `https://speech.googleapis.com/v2/projects/${this.projectId}/locations/${this.location}/recognizers/_:recognize`;

		let response: Response;
		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			response = await fetch(url, {
				method: 'POST',
				headers: {
					'X-goog-api-key': this.apiKey,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
			});
		} catch (err) {
			logger.error(COMPONENT, 'Transcription network error', {
				error: err instanceof Error ? err.message : String(err),
			});
			classifyGoogleCloudError(err);
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
			classifyGoogleCloudError({
				status: response.status,
				message: typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody
					? (errorBody as { message: string }).message
					: '',
			});
		}

		const json = await response.json() as GoogleRecognizeResponse;

		if (json.error) {
			classifyGoogleCloudOperationError(json.error);
		}

		const allWords: GoogleWordInfo[] = [];
		const transcripts: string[] = [];

		for (const result of json.results ?? []) {
			const alt = result.alternatives?.[0];
			if (!alt) continue;

			if (alt.transcript) {
				transcripts.push(alt.transcript);
			}

			if (alt.words) {
				allWords.push(...alt.words);
			}
		}

		let segments: TranscriptionSegment[];
		if (allWords.length > 0) {
			segments = mergeWordsIntoSegments(allWords);
		} else {
			segments = transcripts.map((text) => ({
				start: 0,
				end: 0,
				text,
			}));
		}

		const fullText = transcripts.join(' ');

		const result: TranscriptionResult = {
			version: 1,
			audioFile: '',
			provider: this.name,
			model,
			language: languageCode,
			segments,
			fullText,
			createdAt: new Date().toISOString(),
		};

		logger.debug(COMPONENT, 'Transcription complete', {
			segmentCount: segments.length,
			textLength: fullText.length,
		});

		return result;
	}

	async validateApiKey(key: string): Promise<boolean> {
		if (!this.projectId || !key) {
			return false;
		}

		logger.debug(COMPONENT, 'Validating Google Cloud STT credentials');

		try {
			const url = `https://speech.googleapis.com/v2/projects/${this.projectId}/locations/${this.location}/recognizers`;
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'X-goog-api-key': key,
				},
			});

			if (response.status === 401 || response.status === 403) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}
}
