import { classifyGeminiError } from '../gemini-error-utils';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult, TranscriptionSegment, ProviderCredentials } from '../types';

const COMPONENT = 'GeminiSTTProvider';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const INLINE_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)', supportsDiarization: true },
	{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Accurate)', supportsDiarization: true },
	{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', supportsDiarization: true },
];

interface GeminiSegment {
	speaker: string;
	start: number;
	end: number;
	text: string;
}

const RESPONSE_SCHEMA = {
	type: 'ARRAY',
	items: {
		type: 'OBJECT',
		properties: {
			speaker: { type: 'STRING' },
			start: { type: 'NUMBER' },
			end: { type: 'NUMBER' },
			text: { type: 'STRING' },
		},
		required: ['speaker', 'start', 'end', 'text'],
	},
};

function buildTranscriptionPrompt(languageInstruction: string): string {
	return `Transcribe this audio recording precisely. For each speaker turn, output a JSON segment with:
- "speaker": Label as "Participant 1", "Participant 2", etc. in order of first appearance
- "start": Start time in seconds (float, e.g., 1.5)
- "end": End time in seconds (float, e.g., 4.2)
- "text": Exact transcribed text for this turn

${languageInstruction}

Output ONLY the JSON array of segments, no other text.`;
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

function getMimeType(audioMimeType?: string, audioFileName?: string): string {
	if (audioMimeType) return audioMimeType;
	if (audioFileName) {
		const ext = audioFileName.split('.').pop()?.toLowerCase();
		const mimeMap: Record<string, string> = {
			wav: 'audio/wav',
			mp3: 'audio/mp3',
			aiff: 'audio/aiff',
			aac: 'audio/aac',
			ogg: 'audio/ogg',
			flac: 'audio/flac',
			m4a: 'audio/mp4',
			mp4: 'audio/mp4',
			webm: 'audio/webm',
		};
		if (ext && mimeMap[ext]) return mimeMap[ext];
	}
	return 'audio/wav';
}

export class GeminiSTTProvider implements STTProvider {
	readonly name = 'gemini';

	private apiKey = '';

	setCredentials(credentials: ProviderCredentials): void {
		if (credentials.type === 'gemini') {
			this.apiKey = credentials.apiKey;
		}
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	getSupportedFormats(): string[] {
		return ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac'];
	}

	getMaxDuration(): number | null {
		return 34200;
	}

	getRequiredCredentials(): string[] {
		return ['apiKey'];
	}

	mapLanguageCode(language: string): string | undefined {
		const mapping: Record<string, string> = {
			'ko': 'Transcribe in Korean (한국어).',
			'en': 'Transcribe in English.',
			'ja': 'Transcribe in Japanese (日本語).',
			'zh': 'Transcribe in Chinese (中文).',
		};
		if (language === 'auto' || !language) return 'Auto-detect the language.';
		return mapping[language] ?? `Transcribe in language: ${language}.`;
	}

	async transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult> {
		const model = options.model || 'gemini-2.5-flash';
		const languageInstruction = this.mapLanguageCode(options.language ?? 'auto') ?? 'Auto-detect the language.';
		const mimeType = getMimeType(options.audioMimeType, options.audioFileName);

		logger.debug(COMPONENT, 'Starting transcription', {
			model,
			language: options.language,
			audioSize: audio.byteLength,
			mimeType,
		});

		const prompt = buildTranscriptionPrompt(languageInstruction);
		let audioPart: Record<string, unknown>;

		if (audio.byteLength >= INLINE_SIZE_LIMIT) {
			const fileUri = await this.uploadFile(audio, mimeType);
			audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } };
		} else {
			const base64Content = arrayBufferToBase64(audio);
			audioPart = { inline_data: { mime_type: mimeType, data: base64Content } };
		}

		const requestBody = {
			contents: [{
				parts: [
					audioPart,
					{ text: prompt },
				],
			}],
			generationConfig: {
				response_mime_type: 'application/json',
				response_schema: RESPONSE_SCHEMA,
			},
		};

		const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;

		let response: Response;
		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});
		} catch (err) {
			logger.error(COMPONENT, 'Transcription network error', {
				error: err instanceof Error ? err.message : String(err),
			});
			classifyGeminiError(err);
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
			classifyGeminiError({
				status: response.status,
				message: typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody
					? (errorBody as { message: string }).message
					: '',
			});
		}

		const json = await response.json() as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		};
		const text: string | undefined = json.candidates?.[0]?.content?.parts?.[0]?.text;

		if (!text) {
			logger.error(COMPONENT, 'Empty response from Gemini', { json });
			classifyGeminiError({ status: 500, message: 'Empty response from Gemini API' });
		}

		let segments: GeminiSegment[];
		try {
			segments = JSON.parse(text) as GeminiSegment[];
		} catch {
			logger.error(COMPONENT, 'Failed to parse Gemini response', { text });
			classifyGeminiError({ status: 500, message: 'Invalid JSON in Gemini response' });
		}

		if (!Array.isArray(segments)) {
			segments = [];
		}

		const transcriptionSegments: TranscriptionSegment[] = segments.map(s => ({
			speaker: s.speaker,
			start: s.start,
			end: s.end,
			text: s.text,
		}));

		const fullText = segments.map(s => s.text).join('\n');

		const result: TranscriptionResult = {
			version: 1,
			audioFile: options.audioFileName ?? '',
			provider: this.name,
			model,
			language: options.language ?? 'auto',
			segments: transcriptionSegments,
			fullText,
			createdAt: new Date().toISOString(),
		};

		logger.debug(COMPONENT, 'Transcription complete', {
			segmentCount: transcriptionSegments.length,
			textLength: fullText.length,
		});

		return result;
	}

	private async uploadFile(audio: ArrayBuffer, mimeType: string): Promise<string> {
		logger.debug(COMPONENT, 'Uploading large file via Files API', { size: audio.byteLength });

		const startUrl = `${GEMINI_API_BASE.replace('/v1beta', '')}/upload/v1beta/files?key=${this.apiKey}`;

		let startResponse: Response;
		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			startResponse = await fetch(startUrl, {
				method: 'POST',
				headers: {
					'X-Goog-Upload-Protocol': 'resumable',
					'X-Goog-Upload-Command': 'start',
					'X-Goog-Upload-Header-Content-Length': String(audio.byteLength),
					'X-Goog-Upload-Header-Content-Type': mimeType,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ file: { display_name: 'audio-upload' } }),
			});
		} catch (err) {
			classifyGeminiError(err);
		}

		if (!startResponse.ok) {
			classifyGeminiError({ status: startResponse.status, message: 'File upload initiation failed' });
		}

		const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
		if (!uploadUrl) {
			classifyGeminiError({ status: 500, message: 'No upload URL returned from Files API' });
		}

		let uploadResponse: Response;
		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: {
					'X-Goog-Upload-Command': 'upload, finalize',
					'X-Goog-Upload-Offset': '0',
					'Content-Type': mimeType,
				},
				body: audio,
			});
		} catch (err) {
			classifyGeminiError(err);
		}

		if (!uploadResponse.ok) {
			classifyGeminiError({ status: uploadResponse.status, message: 'File upload failed' });
		}

		const uploadJson = await uploadResponse.json() as { file?: { uri?: string } };
		const fileUri: string | undefined = uploadJson.file?.uri;
		if (!fileUri) {
			classifyGeminiError({ status: 500, message: 'No file URI returned from upload' });
		}

		logger.debug(COMPONENT, 'File uploaded successfully', { fileUri });
		return fileUri;
	}

	async validateApiKey(key: string): Promise<boolean> {
		if (!key) return false;

		logger.debug(COMPONENT, 'Validating Gemini API key');

		try {
			const url = `${GEMINI_API_BASE}/models?key=${key}`;
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			const response = await fetch(url, { method: 'GET' });

			if (response.status === 401 || response.status === 403 || response.status === 400) {
				return false;
			}
			return response.ok;
		} catch {
			return false;
		}
	}
}
