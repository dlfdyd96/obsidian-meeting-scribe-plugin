import { App, ButtonComponent, PluginSettingTab, Setting } from 'obsidian';
import type MeetingScribePlugin from '../main';
import { providerRegistry } from '../providers/provider-registry';
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
	'gpt-4o-transcribe': 'GPT-4o transcribe',
	'gpt-4o-transcribe-diarize': 'GPT-4o transcribe (with diarization)',
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

const PROVIDER_KEY_URLS: Record<string, string> = {
	openai: 'platform.openai.com/api-keys',
	anthropic: 'console.anthropic.com/settings/keys',
};

function getApiKeyDesc(provider: string): string {
	const url = PROVIDER_KEY_URLS[provider];
	return url ? `Required — get your API key at ${url}` : 'API key for this provider';
}

function setDescStatus(descEl: HTMLElement, text: string, isValid: boolean): void {
	descEl.textContent = text;
	descEl.removeClass('meeting-scribe-api-status-valid', 'meeting-scribe-api-status-error');
	descEl.addClass(isValid ? 'meeting-scribe-api-status-valid' : 'meeting-scribe-api-status-error');
}

async function validateApiKeyWithUI(
	button: ButtonComponent,
	descEl: HTMLElement,
	validateFn: (key: string) => Promise<boolean>,
	key: string,
): Promise<void> {
	if (!key) {
		setDescStatus(descEl, '✗ Enter an API key first', false);
		return;
	}

	button.setButtonText('Checking...');
	button.setDisabled(true);

	try {
		const isValid = await validateFn(key);
		if (isValid) {
			setDescStatus(descEl, '✓ Valid', true);
		} else {
			setDescStatus(descEl, '✗ Invalid — key not recognized', false);
		}
	} catch {
		setDescStatus(descEl, '✗ Connection failed — check your network', false);
	} finally {
		button.setButtonText('Test');
		button.setDisabled(false);
	}
}

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

		const sttKeySetting = new Setting(containerEl)
			.setName('Speech-to-text API key')
			.setDesc(getApiKeyDesc(this.plugin.settings.sttProvider))
			.addText(cb => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				cb.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.sttApiKey)
					.onChange(async (value) => {
						this.plugin.settings.sttApiKey = value;
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = 'password';
			})
			.addButton(cb => cb
				.setButtonText('Test')
				.onClick(async () => {
					const provider = providerRegistry.getSTTProvider(this.plugin.settings.sttProvider);
					if (!provider) return;
					await validateApiKeyWithUI(
						cb,
						sttKeySetting.descEl,
						(key) => provider.validateApiKey(key),
						this.plugin.settings.sttApiKey,
					);
				}));

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

		const llmKeySetting = new Setting(containerEl)
			.setName('Language model API key')
			.setDesc(getApiKeyDesc(this.plugin.settings.llmProvider))
			.addText(cb => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				cb.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llmApiKey)
					.onChange(async (value) => {
						this.plugin.settings.llmApiKey = value;
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = 'password';
			})
			.addButton(cb => cb
				.setButtonText('Test')
				.onClick(async () => {
					const provider = providerRegistry.getLLMProvider(this.plugin.settings.llmProvider);
					if (!provider) return;
					await validateApiKeyWithUI(
						cb,
						llmKeySetting.descEl,
						(key) => provider.validateApiKey(key),
						this.plugin.settings.llmApiKey,
					);
				}));

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

		new Setting(containerEl).setName('Test setup').setHeading();

		const testSetting = new Setting(containerEl)
			.setName('Run test recording')
			.setDesc('Record 5 seconds and process through the full pipeline to verify your setup')
			.addButton(cb => cb
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setButtonText('Run Test')
				.onClick(async () => {
					if (!this.plugin.settings.sttApiKey || !this.plugin.settings.llmApiKey) {
						setDescStatus(testSetting.descEl, '✗ Enter API keys first', false);
						return;
					}

					testResultEl.empty();
					cb.setButtonText('Recording...');
					cb.setDisabled(true);

					const onProgress = (step: string) => {
						const displayNames: Record<string, string> = {
							transcribing: 'Transcribing...',
							summarizing: 'Summarizing...',
							generating: 'Generating note...',
						};
						cb.setButtonText(displayNames[step] ?? 'Processing...');
					};

					try {
						const result = await this.plugin.runTestRecording(onProgress);

						if (result.success) {
							testSetting.setDesc('');
							setDescStatus(testSetting.descEl, '✓ Test passed', true);
							testResultEl.empty();
							if (result.transcriptPreview) {
								testResultEl.createEl('div', {
									text: `Transcription: ${result.transcriptPreview}...`,
									cls: 'meeting-scribe-test-transcript',
								});
							}
							if (result.noteFilePath) {
								testResultEl.createEl('div', {
									// eslint-disable-next-line obsidianmd/ui/sentence-case
									text: '✓ Note generated successfully',
									cls: 'meeting-scribe-api-status-valid',
								});
							}
							this.plugin.noticeManager.showTestSuccess();
						} else {
							const guidance = result.failedStep
								? `Test failed at ${result.failedStep}`
								: 'Test failed';
							setDescStatus(testSetting.descEl, `✗ ${guidance}`, false);
							testResultEl.empty();
							testResultEl.createEl('div', {
								text: result.error ?? 'Unknown error',
								cls: 'meeting-scribe-api-status-error',
							});
						}
					} catch {
						setDescStatus(testSetting.descEl, '✗ Test failed — unexpected error', false);
					} finally {
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						cb.setButtonText('Run Test');
						cb.setDisabled(false);
					}
				}));

		const testResultEl = containerEl.createDiv({ cls: 'meeting-scribe-test-result' });

		const advancedEl = containerEl.createEl('details');
		advancedEl.createEl('summary', { text: 'Advanced settings' });

		new Setting(advancedEl)
			.setName('Include transcript in notes')
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc('Append the full STT transcript below the summary in generated notes')
			.addToggle(cb => cb
				.setValue(this.plugin.settings.includeTranscript)
				.onChange(async (value) => {
					this.plugin.settings.includeTranscript = value;
					await this.plugin.saveSettings();
				}));

		new Setting(advancedEl)
			.setName('Smart chunking')
			.setDesc('Use silence detection to find natural split points for large audio files. Slower but may improve transcription accuracy at chunk boundaries.')
			.addToggle(cb => cb
				.setValue(this.plugin.settings.enableSmartChunking)
				.onChange(async (value) => {
					this.plugin.settings.enableSmartChunking = value;
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
