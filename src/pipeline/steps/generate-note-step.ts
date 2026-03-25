import { normalizePath } from 'obsidian';
import type { Vault } from 'obsidian';
import type { PipelineStep, PipelineContext } from '../pipeline-types';
import { DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { generateNote, generateFilename, generateTranscriptNote, generateTranscriptFilename, generateTemplateNote, extractParticipants } from '../../note/note-generator';

const COMPONENT = 'GenerateNoteStep';

function getUniquePath(vault: Vault, folder: string, filename: string): string {
	let targetPath = normalizePath(`${folder}/${filename}`);
	let counter = 2;
	while (vault.getAbstractFileByPath(targetPath)) {
		const base = filename.replace(/\.md$/, '');
		targetPath = normalizePath(`${folder}/${base} ${counter}.md`);
		counter++;
	}
	return targetPath;
}

export class GenerateNoteStep implements PipelineStep {
	readonly name = 'generate-note';

	async execute(context: PipelineContext): Promise<PipelineContext> {
		const { vault, settings, audioFilePath } = context;

		if (!context.transcriptionResult) {
			throw new DataError('No transcription result available for note generation');
		}

		logger.info(COMPONENT, 'Generating note', {
			outputFolder: settings.outputFolder,
			separateTranscriptFile: settings.separateTranscriptFile,
			enableSummary: settings.enableSummary,
		});

		// Ensure output folder exists
		const outputFolder = settings.outputFolder;
		const folderExists = vault.getAbstractFileByPath(outputFolder);
		if (!folderExists) {
			await vault.createFolder(outputFolder);
		}

		// Extract participant aliases from transcription segments
		const participants = extractParticipants(context.transcriptionResult);

		// Resolve transcript JSON path for frontmatter linking
		const transcriptDataPath = context.transcriptFilePath ?? `${audioFilePath}.transcript.json`;

		// Generate filename: from summary metadata if available, otherwise from audio filename
		const noteFilename = context.summaryResult
			? generateFilename(context.summaryResult.metadata)
			: this.filenameFromAudioPath(audioFilePath);
		const useSeparateTranscript = settings.includeTranscript && settings.separateTranscriptFile;

		// No-summary mode: generate template note
		if (!context.summaryResult) {
			const targetPath = getUniquePath(vault, outputFolder, noteFilename);
			const noteContent = generateTemplateNote({
				transcriptionResult: context.transcriptionResult,
				audioFilePath,
				participants,
				transcriptDataPath,
			});
			await vault.create(targetPath, noteContent);

			context.onProgress?.('generating-note', 1, 1);
			logger.info(COMPONENT, 'Template note generated (no summary)', { path: targetPath });
			return { ...context, noteFilePath: targetPath };
		}

		if (useSeparateTranscript) {
			const transcriptFilename = generateTranscriptFilename(noteFilename);

			// Handle duplicate filenames for both files BEFORE generating content
			const notePath = getUniquePath(vault, outputFolder, noteFilename);
			const transcriptPath = getUniquePath(vault, outputFolder, transcriptFilename);

			// Derive titles from resolved paths (after dedup) for correct wiki-links
			const noteTitle = notePath.split('/').pop()!.replace(/\.md$/, '');
			const transcriptTitle = transcriptPath.split('/').pop()!.replace(/\.md$/, '');

			// Build note content with wiki-link to transcript
			const noteContent = generateNote({
				summaryResult: context.summaryResult,
				transcriptionResult: context.transcriptionResult,
				audioFilePath,
				transcriptLink: `[[${transcriptTitle}]]`,
				participants,
				transcriptDataPath,
			});

			// Build transcript content with back-link to meeting note
			const transcriptContent = generateTranscriptNote({
				summaryResult: context.summaryResult,
				transcriptionResult: context.transcriptionResult,
				audioFilePath,
				meetingNoteLink: `[[${noteTitle}]]`,
				participants,
			});

			// Save both files
			await vault.create(notePath, noteContent);
			await vault.create(transcriptPath, transcriptContent);

			context.onProgress?.('generating-note', 1, 1);

			logger.info(COMPONENT, 'Note and transcript generated', {
				notePath,
				transcriptPath,
			});

			return { ...context, noteFilePath: notePath, transcriptFilePath: transcriptPath };
		}

		// Single-file mode (default / backward compatible)
		const noteContent = generateNote({
			summaryResult: context.summaryResult,
			transcriptionResult: context.transcriptionResult,
			audioFilePath,
			includeTranscript: settings.includeTranscript,
			participants,
			transcriptDataPath,
		});

		const targetPath = getUniquePath(vault, outputFolder, noteFilename);
		await vault.create(targetPath, noteContent);

		context.onProgress?.('generating-note', 1, 1);

		logger.info(COMPONENT, 'Note generated', { path: targetPath });

		return { ...context, noteFilePath: targetPath };
	}

	private filenameFromAudioPath(audioFilePath: string): string {
		const raw = audioFilePath.split('/').pop() ?? audioFilePath;
		const base = raw.includes('.') ? raw.split('.').slice(0, -1).join('.') : raw;
		return `${base}.md`;
	}
}
