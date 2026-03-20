import { TFile, normalizePath } from 'obsidian';
import type { PipelineStep, PipelineContext } from '../pipeline-types';
import type { TranscriptionResult, TranscriptionSegment } from '../../providers/types';
import { chunkAudio } from '../chunker';
import { SUPPORTED_AUDIO_FORMATS, DIARIZE_MAX_DURATION_SECONDS } from '../../constants';
import { providerRegistry } from '../../providers/provider-registry';
import { ConfigError, DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const COMPONENT = 'TranscribeStep';

function getTranscriptPath(audioFilePath: string): string {
	return normalizePath(`${audioFilePath}.transcript.json`);
}

export class TranscribeStep implements PipelineStep {
	readonly name = 'transcribe';

	async execute(context: PipelineContext): Promise<PipelineContext> {
		const { audioFilePath, vault, settings } = context;
		const transcriptPath = getTranscriptPath(audioFilePath);

		// Check for cached transcript
		if (!context.forceRetranscribe) {
			const existingFile = vault.getAbstractFileByPath(transcriptPath);
			if (existingFile instanceof TFile) {
				const content = await vault.read(existingFile);
				try {
					const cached = JSON.parse(content) as TranscriptionResult;
					if (cached.model === settings.sttModel) {
						logger.info(COMPONENT, 'Cached transcript found, skipping API call', {
							path: transcriptPath,
						});
						return { ...context, transcriptionResult: cached };
					}
					logger.info(COMPONENT, 'Cached transcript model mismatch, will re-transcribe', {
						cachedModel: cached.model,
						currentModel: settings.sttModel,
					});
				} catch {
					logger.warn(COMPONENT, 'Corrupt transcript cache, will re-transcribe', {
						path: transcriptPath,
					});
				}
			}
		}

		// Read audio file
		const audioFile = vault.getAbstractFileByPath(audioFilePath);
		if (!(audioFile instanceof TFile)) {
			throw new DataError(`Audio file not found: ${audioFilePath}`);
		}

		// Validate audio format before any processing
		const ext = audioFilePath.split('.').pop()?.toLowerCase() ?? '';
		if (!(SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(ext)) {
			throw new ConfigError(
				`Unsupported audio format: .${ext}. Supported: mp3, mp4, m4a, wav, webm`
			);
		}

		logger.info(COMPONENT, 'Starting transcription', { audioFilePath });

		const audioData = await vault.readBinary(audioFile);

		// Chunk audio — use duration guard override if set, otherwise fall back to diarize limit
		const isDiarization = settings.sttModel === 'gpt-4o-transcribe-diarize';
		const maxDurationSeconds = context.maxDurationOverride
			?? (isDiarization ? DIARIZE_MAX_DURATION_SECONDS : undefined);
		const chunks = await chunkAudio(audioData, {
			enableSmartChunking: settings.enableSmartChunking,
			maxDurationSeconds,
		});
		const totalChunks = chunks.length;

		// Get STT provider
		const provider = providerRegistry.getSTTProvider(settings.sttProvider);
		if (!provider) {
			throw new ConfigError(`STT provider not found: ${settings.sttProvider}`);
		}

		// Set API key on provider
		if (!settings.sttApiKey) {
			throw new ConfigError('STT API key is not configured');
		}
		if ('setApiKey' in provider && typeof (provider as { setApiKey: (k: string) => void }).setApiKey === 'function') {
			(provider as { setApiKey: (k: string) => void }).setApiKey(settings.sttApiKey);
		}

		// Transcribe each chunk
		const results: TranscriptionResult[] = [];
		for (const chunk of chunks) {
			const result = await provider.transcribe(chunk.data, {
				model: settings.sttModel,
				language: settings.sttLanguage === 'auto' ? undefined : settings.sttLanguage,
				audioMimeType: chunk.mimeType,
				audioFileName: `audio.${chunk.fileExtension}`,
			});
			results.push(result);

			context.onProgress?.('transcribing', chunk.chunkIndex + 1, totalChunks);

			logger.debug(COMPONENT, 'Chunk transcribed', {
				chunkIndex: chunk.chunkIndex,
				totalChunks,
			});
		}

		// Merge results
		const merged = this.mergeResults(results, chunks.map(c => c.startTime), audioFilePath);

		// Save transcript
		const transcriptJson = JSON.stringify(merged, null, 2);
		const existingTranscript = vault.getAbstractFileByPath(transcriptPath);
		if (existingTranscript instanceof TFile) {
			await vault.modify(existingTranscript, transcriptJson);
		} else {
			await vault.create(transcriptPath, transcriptJson);
		}

		logger.info(COMPONENT, 'Transcript saved', { path: transcriptPath });

		return { ...context, transcriptionResult: merged };
	}

	private mergeResults(
		results: TranscriptionResult[],
		chunkStartTimes: number[],
		audioFilePath: string,
	): TranscriptionResult {
		if (results.length === 0) {
			throw new DataError('No transcription results to merge');
		}

		const firstResult = results[0]!;
		const mergedSegments: TranscriptionSegment[] = [];

		for (let i = 0; i < results.length; i++) {
			const result = results[i]!;
			const offset = chunkStartTimes[i]!;

			for (const segment of result.segments) {
				mergedSegments.push({
					...segment,
					start: segment.start + offset,
					end: segment.end + offset,
				});
			}
		}

		return {
			version: 1,
			audioFile: audioFilePath,
			provider: firstResult.provider,
			model: firstResult.model,
			language: firstResult.language,
			segments: mergedSegments,
			fullText: results.map(r => r.fullText).join(' '),
			createdAt: new Date().toISOString(),
		};
	}
}
