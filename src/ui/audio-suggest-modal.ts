import { SuggestModal, TFile, App, Notice } from 'obsidian';
import { SUPPORTED_AUDIO_FORMATS } from '../constants';
import { logger } from '../utils/logger';

function formatFileSize(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export class AudioSuggestModal extends SuggestModal<TFile> {
	private readonly onSelect: (filePath: string) => void;

	constructor(
		app: App,
		onSelect: (filePath: string) => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder('Search audio files...');
		this.emptyStateText = 'No audio files found in vault';
	}

	getSuggestions(query: string): TFile[] {
		const files = this.app.vault.getFiles();
		const audioFiles = files.filter((file: TFile) =>
			(SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(file.extension),
		);

		if (!query) {
			return audioFiles;
		}

		const lowerQuery = query.toLowerCase();
		return audioFiles.filter((file: TFile) =>
			file.path.toLowerCase().includes(lowerQuery),
		);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const container = el.createEl('div');
		container.createEl('div', { text: file.path });
		container.createEl('small', { text: formatFileSize(file.stat.size) });
	}

	onChooseSuggestion(file: TFile): void {
		this.onSelect(file.path);
		new Notice('Audio file selected — ready for processing');
		logger.debug('AudioSuggestModal', 'File selected', { path: file.path });
	}
}
