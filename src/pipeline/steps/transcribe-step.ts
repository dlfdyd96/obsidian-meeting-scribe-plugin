import { TFile } from 'obsidian';
import type { PipelineStep, PipelineContext } from '../pipeline-types';
import type { TranscriptionResult, TranscriptionSegment } from '../../providers/types';
import { chunkAudio } from '../chunker';
import { providerRegistry } from '../../providers/provider-registry';
import { ConfigError, DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const COMPONENT = 'TranscribeStep';

function getTranscriptPath(audioFilePath: string): string {
	return `${audioFilePath}.transcript.json`;
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
				logger.info(COMPONENT, 'Cached transcript found, skipping API call', {
					path: transcriptPath,
				});
				const content = await vault.read(existingFile);
				try {
					const cached = JSON.parse(content) as TranscriptionResult;
					return { ...context, transcriptionResult: cached };
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

		logger.info(COMPONENT, 'Starting transcription', { audioFilePath });

		const audioData = await vault.readBinary(audioFile);

		// Chunk audio
		const chunks = await chunkAudio(audioData);
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
