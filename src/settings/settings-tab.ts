import { App, PluginSettingTab, Setting } from 'obsidian';
import type MeetingScribePlugin from '../main';
import { logger } from '../utils/logger';

const LLM_MODELS: Record<string, Record<string, string>> = {
	openai: {
		'gpt-4o': 'GPT-4o',
		'gpt-4o-mini': 'GPT-4o mini',
	},
	anthropic: {
		'claude-sonnet-4-5-20250514': 'Claude Sonnet 4.5',
		'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
	},
};

const STT_MODELS: Record<string, string> = {
	'gpt-4o-mini-transcribe': 'GPT-4o mini transcribe',
	'gpt-4o-transcribe': 'GPT-4o transcribe (with diarization)',
};

const LANGUAGE_OPTIONS: Record<string, string> = {
	'auto': 'Auto',
	'ko': 'Korean (ko)',
	'en': 'English (en)',
	'ja': 'Japanese (ja)',
	'zh': 'Chinese (zh)',
};

const SUMMARY_LANGUAGE_OPTIONS: Record<string, string> = {
	'auto': 'Auto (follow transcript)',
	'ko': 'Korean',
	'en': 'English',
	'ja': 'Japanese',
	'zh': 'Chinese',
};

export class MeetingScribeSettingTab extends PluginSettingTab {
	plugin: MeetingScribePlugin;

	constructor(app: App, plugin: MeetingScribePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('API configuration').setHeading();

		new Setting(containerEl)
			.setName('Speech-to-text provider')
			.setDesc('Provider for audio transcription')
			.addDropdown(cb => cb
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.addOption('openai', 'OpenAI')
				.setValue(this.plugin.settings.sttProvider)
				.onChange(async (value) => {
					this.plugin.settings.sttProvider = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Speech-to-text API key')
			.setDesc('API key for the speech-to-text provider')
			.addText(cb => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				cb.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.sttApiKey)
					.onChange(async (value) => {
						this.plugin.settings.sttApiKey = value;
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Language model provider')
			.setDesc('Provider for summarization')
			.addDropdown(cb => cb
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.addOption('openai', 'OpenAI')
				.addOption('anthropic', 'Anthropic')
				.setValue(this.plugin.settings.llmProvider)
				.onChange(async (value) => {
					this.plugin.settings.llmProvider = value;
					this.plugin.settings.llmModel = '';
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Language model API key')
			.setDesc('API key for the language model provider')
			.addText(cb => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				cb.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llmApiKey)
					.onChange(async (value) => {
						this.plugin.settings.llmApiKey = value;
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = 'password';
			});

		new Setting(containerEl).setName('Output').setHeading();

		new Setting(containerEl)
			.setName('Notes folder')
			.setDesc('Folder for generated meeting notes')
			.addText(cb => cb
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder('Meeting Notes')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Audio folder')
			.setDesc('Folder for audio recordings')
			.addText(cb => cb
				.setPlaceholder('_attachments/audio')
				.setValue(this.plugin.settings.audioFolder)
				.onChange(async (value) => {
					this.plugin.settings.audioFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Recording').setHeading();

		new Setting(containerEl)
			.setName('Speech-to-text model')
			.setDesc('Model for audio transcription')
			.addDropdown(cb => cb
				.addOptions(STT_MODELS)
				.setValue(this.plugin.settings.sttModel)
				.onChange(async (value) => {
					this.plugin.settings.sttModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Speech-to-text language')
			.setDesc('Language hint for transcription accuracy')
			.addDropdown(cb => cb
				.addOptions(LANGUAGE_OPTIONS)
				.setValue(this.plugin.settings.sttLanguage)
				.onChange(async (value) => {
					this.plugin.settings.sttLanguage = value;
					await this.plugin.saveSettings();
				}));

		const llmModels = LLM_MODELS[this.plugin.settings.llmProvider] ?? {};
		new Setting(containerEl)
			.setName('Language model')
			.setDesc('Model for summarization')
			.addDropdown(cb => cb
				.addOptions(llmModels)
				.setValue(this.plugin.settings.llmModel)
				.onChange(async (value) => {
					this.plugin.settings.llmModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Summary language')
			.setDesc('Language for generated meeting notes')
			.addDropdown(cb => cb
				.addOptions(SUMMARY_LANGUAGE_OPTIONS)
				.setValue(this.plugin.settings.summaryLanguage)
				.onChange(async (value) => {
					this.plugin.settings.summaryLanguage = value;
					await this.plugin.saveSettings();
				}));

		const advancedEl = containerEl.createEl('details');
		advancedEl.createEl('summary', { text: 'Advanced settings' });

		new Setting(advancedEl)
			.setName('Include transcript in notes')
			.setDesc('Append the full STT transcript below the summary in generated notes')
			.addToggle(cb => cb
				.setValue(this.plugin.settings.includeTranscript)
				.onChange(async (value) => {
					this.plugin.settings.includeTranscript = value;
					await this.plugin.saveSettings();
				}));

		new Setting(advancedEl)
			.setName('Audio retention policy')
			.setDesc('What to do with audio files after processing')
			.addDropdown(cb => cb
				.addOption('keep', 'Keep')
				.addOption('delete', 'Delete after processing')
				.setValue(this.plugin.settings.audioRetentionPolicy)
				.onChange(async (value) => {
					this.plugin.settings.audioRetentionPolicy = value as 'keep' | 'delete';
					await this.plugin.saveSettings();
				}));

		new Setting(advancedEl)
			.setName('Debug mode')
			.setDesc('Enable detailed logging for troubleshooting')
			.addToggle(cb => cb
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					logger.setDebugMode(value);
					await this.plugin.saveSettings();
				}));
	}
}
