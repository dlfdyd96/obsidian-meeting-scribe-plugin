import { normalizePath } from 'obsidian';
import type { PipelineStep, PipelineContext } from '../pipeline-types';
import { DataError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { generateNote, generateFilename } from '../../note/note-generator';

const COMPONENT = 'GenerateNoteStep';

export class GenerateNoteStep implements PipelineStep {
	readonly name = 'generate-note';

	async execute(context: PipelineContext): Promise<PipelineContext> {
		const { vault, settings, audioFilePath } = context;

		if (!context.summaryResult) {
			throw new DataError('No summary result available for note generation');
		}

		if (!context.transcriptionResult) {
			throw new DataError('No transcription result available for note generation');
		}

		logger.info(COMPONENT, 'Generating note', {
			outputFolder: settings.outputFolder,
		});

		// Build note content
		const noteContent = generateNote({
			summaryResult: context.summaryResult,
			transcriptionResult: context.transcriptionResult,
			audioFilePath,
			includeTranscript: settings.includeTranscript,
		});

		// Generate filename
		const filename = generateFilename(context.summaryResult.metadata);

		// Ensure output folder exists
		const outputFolder = settings.outputFolder;
		const folderExists = vault.getAbstractFileByPath(outputFolder);
		if (!folderExists) {
			await vault.createFolder(outputFolder);
		}

		// Handle duplicate filenames
		let targetPath = normalizePath(`${outputFolder}/${filename}`);
		let counter = 2;
		while (vault.getAbstractFileByPath(targetPath)) {
			const base = filename.replace(/\.md$/, '');
			targetPath = normalizePath(`${outputFolder}/${base} ${counter}.md`);
			counter++;
		}

		// Save to vault
		await vault.create(targetPath, noteContent);

		context.onProgress?.('generating-note', 1, 1);

		logger.info(COMPONENT, 'Note generated', { path: targetPath });

		return { ...context, noteFilePath: targetPath };
	}
}
