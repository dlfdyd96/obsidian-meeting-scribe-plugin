// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { MeetingScribeSettingTab } from '../../src/settings/settings-tab';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import type { MeetingScribeSettings } from '../../src/settings/settings';
import { providerRegistry } from '../../src/providers/provider-registry';
import { logger } from '../../src/utils/logger';

function createMockPlugin(settingsOverrides?: Partial<MeetingScribeSettings>) {
	const settings: MeetingScribeSettings = { ...DEFAULT_SETTINGS, ...settingsOverrides };
	return {
		app: {},
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		manifest: {},
		loadData: vi.fn(),
		saveData: vi.fn(),
		addRibbonIcon: vi.fn(),
		addStatusBarItem: vi.fn(),
		addCommand: vi.fn(),
		addSettingTab: vi.fn(),
		registerDomEvent: vi.fn(),
		registerInterval: vi.fn(),
		runTestRecording: vi.fn().mockResolvedValue({ success: true, transcriptPreview: 'Hello world', noteFilePath: 'Meeting Notes/test.md' }),
		noticeManager: {
			showTestSuccess: vi.fn(),
			showWelcome: vi.fn(),
			showMissingApiKeys: vi.fn(),
		},
	};
}

describe('MeetingScribeSettingTab', () => {
	let tab: MeetingScribeSettingTab;
	let mockPlugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		mockPlugin = createMockPlugin();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		tab = new MeetingScribeSettingTab({} as any, mockPlugin as any);
	});

	describe('display()', () => {
		it('should clear the container before rendering', () => {
			const emptySpy = vi.spyOn(tab.containerEl, 'empty' as never);
			tab.display();
			expect(emptySpy).toHaveBeenCalled();
		});

		it('should create all section headings', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const headings = settingInstances.filter(s => s.isHeading());
			expect(headings).toHaveLength(4);
			expect(headings.map(h => h.getName())).toEqual([
				'API configuration',
				'Output',
				'Recording',
				'Test setup',
			]);
			// Advanced section is the <details> element
			const details = tab.containerEl.querySelector('details');
			expect(details).not.toBeNull();
		});

		it('should create a details element for Advanced section', () => {
			tab.display();
			const details = tab.containerEl.querySelector('details');
			expect(details).not.toBeNull();
		});

		it('should have summary text "Advanced settings" in details', () => {
			tab.display();
			const summary = tab.containerEl.querySelector('details > summary');
			expect(summary).not.toBeNull();
			expect(summary?.textContent).toBe('Advanced settings');
		});
	});

	describe('Setting changes call saveSettings()', () => {
		it('should call saveSettings when STT provider changes', async () => {
			tab.display();
			// Find the STT Provider Setting — it's the first dropdown after the heading
			const settingInstances = collectSettings(tab.containerEl);
			const sttProviderSetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text provider');
			expect(sttProviderSetting).toBeDefined();

			const dropdown = sttProviderSetting!.dropdownComponents[0];
			expect(dropdown).toBeDefined();
			dropdown!.triggerChange('openai');
			// Allow async onChange to complete
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
		});

		it('should call saveSettings when STT API Key changes', async () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttApiKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			expect(sttApiKeySetting).toBeDefined();

			const text = sttApiKeySetting!.textComponents[0];
			expect(text).toBeDefined();
			text!.triggerChange('new-key');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.sttApiKey).toBe('new-key');
		});

		it('should mask STT API Key input as password', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttApiKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			expect(sttApiKeySetting).toBeDefined();
			const text = sttApiKeySetting!.textComponents[0];
			expect(text).toBeDefined();
			expect(text!.inputEl.type).toBe('password');
		});

		it('should mask LLM API Key input as password', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmApiKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Language model API key');
			expect(llmApiKeySetting).toBeDefined();
			const text = llmApiKeySetting!.textComponents[0];
			expect(text).toBeDefined();
			expect(text!.inputEl.type).toBe('password');
		});

		it('should call saveSettings when LLM provider changes and reset llmModel', async () => {
			mockPlugin.settings.llmModel = 'gpt-4o';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmProviderSetting = settingInstances.find(s => s.nameEl.textContent === 'Language model provider');
			expect(llmProviderSetting).toBeDefined();

			const dropdown = llmProviderSetting!.dropdownComponents[0];
			expect(dropdown).toBeDefined();
			dropdown!.triggerChange('anthropic');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.llmProvider).toBe('anthropic');
			expect(mockPlugin.settings.llmModel).toBe('');
		});

		it('should call saveSettings when output folder changes', async () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const notesFolderSetting = settingInstances.find(s => s.nameEl.textContent === 'Notes folder');
			expect(notesFolderSetting).toBeDefined();

			const text = notesFolderSetting!.textComponents[0];
			text!.triggerChange('My Notes');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.outputFolder).toBe('My Notes');
		});

		it('should call saveSettings when audio folder changes', async () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const audioFolderSetting = settingInstances.find(s => s.nameEl.textContent === 'Audio folder');
			expect(audioFolderSetting).toBeDefined();

			const text = audioFolderSetting!.textComponents[0];
			text!.triggerChange('audio');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.audioFolder).toBe('audio');
		});

		it('should call saveSettings when STT model changes', async () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttModelSetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text model');
			expect(sttModelSetting).toBeDefined();

			const dropdown = sttModelSetting!.dropdownComponents[0];
			dropdown!.triggerChange('gpt-4o-transcribe');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.sttModel).toBe('gpt-4o-transcribe');
		});

		it('should call saveSettings when LLM model changes', async () => {
			mockPlugin.settings.llmProvider = 'openai';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmModelSetting = settingInstances.find(s => s.nameEl.textContent === 'Language model');
			expect(llmModelSetting).toBeDefined();

			const dropdown = llmModelSetting!.dropdownComponents[0];
			dropdown!.triggerChange('gpt-4o');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.llmModel).toBe('gpt-4o');
		});

		it('should call saveSettings when audio retention policy changes', async () => {
			tab.display();
			const details = tab.containerEl.querySelector('details');
			expect(details).not.toBeNull();
			const advancedSettings = collectSettings(details!);
			const retentionSetting = advancedSettings.find(s => s.nameEl.textContent === 'Audio retention policy');
			expect(retentionSetting).toBeDefined();

			const dropdown = retentionSetting!.dropdownComponents[0];
			dropdown!.triggerChange('delete');
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.audioRetentionPolicy).toBe('delete');
		});
	});

	describe('Recording consent reminder toggle', () => {
		it('should call saveSettings when consent reminder toggle changes', async () => {
			tab.display();
			const details = tab.containerEl.querySelector('details');
			expect(details).not.toBeNull();
			const advancedSettings = collectSettings(details!);
			const consentSetting = advancedSettings.find(s => s.nameEl.textContent === 'Recording consent reminder');
			expect(consentSetting).toBeDefined();

			const toggle = consentSetting!.toggleComponents[0];
			toggle!.triggerChange(false);
			await flushPromises();
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.showConsentReminder).toBe(false);
		});
	});

	describe('Separate transcript file toggle visibility', () => {
		it('should show separate transcript toggle when includeTranscript is true', () => {
			mockPlugin.settings.includeTranscript = true;
			tab.display();
			const details = tab.containerEl.querySelector('details');
			const advancedSettings = collectSettings(details!);
			const separateSetting = advancedSettings.find(s => s.nameEl.textContent === 'Separate transcript file');
			expect(separateSetting).toBeDefined();
			expect(separateSetting!.settingEl.classList.contains('meeting-scribe-hidden')).toBe(false);
		});

		it('should hide separate transcript toggle when includeTranscript is false', () => {
			mockPlugin.settings.includeTranscript = false;
			tab.display();
			const details = tab.containerEl.querySelector('details');
			const advancedSettings = collectSettings(details!);
			const separateSetting = advancedSettings.find(s => s.nameEl.textContent === 'Separate transcript file');
			expect(separateSetting).toBeDefined();
			expect(separateSetting!.settingEl.classList.contains('meeting-scribe-hidden')).toBe(true);
		});

		it('should toggle separate transcript visibility without collapsing advanced section', async () => {
			mockPlugin.settings.includeTranscript = true;
			tab.display();
			const details = tab.containerEl.querySelector('details')!;
			details.open = true;

			const advancedSettings = collectSettings(details);
			const includeSetting = advancedSettings.find(s => s.nameEl.textContent === 'Include transcript in notes');
			const toggle = includeSetting!.toggleComponents[0];

			// Turn off includeTranscript
			toggle!.triggerChange(false);
			await flushPromises();

			// Advanced section should stay open
			expect(details.open).toBe(true);
			// Separate transcript setting should be hidden
			const separateSetting = advancedSettings.find(s => s.nameEl.textContent === 'Separate transcript file');
			expect(separateSetting!.settingEl.classList.contains('meeting-scribe-hidden')).toBe(true);
		});
	});

	describe('Debug Mode toggle', () => {
		it('should call logger.setDebugMode when debug toggle changes', async () => {
			const setDebugSpy = vi.spyOn(logger, 'setDebugMode').mockImplementation(() => {});
			tab.display();
			const details = tab.containerEl.querySelector('details');
			expect(details).not.toBeNull();
			const advancedSettings = collectSettings(details!);
			const debugSetting = advancedSettings.find(s => s.nameEl.textContent === 'Debug mode');
			expect(debugSetting).toBeDefined();

			const toggle = debugSetting!.toggleComponents[0];
			toggle!.triggerChange(true);
			await flushPromises();
			expect(setDebugSpy).toHaveBeenCalledWith(true);
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
			expect(mockPlugin.settings.debugMode).toBe(true);
		});
	});

	describe('LLM Model provider-dependent options', () => {
		it('should show OpenAI models when llmProvider is openai', () => {
			mockPlugin.settings.llmProvider = 'openai';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmModelSetting = settingInstances.find(s => s.nameEl.textContent === 'Language model');
			expect(llmModelSetting).toBeDefined();

			const dropdown = llmModelSetting!.dropdownComponents[0];
			const options = dropdown!.getOptions();
			expect(options).toHaveProperty('gpt-4o');
			expect(options).toHaveProperty('gpt-4o-mini');
			expect(options).not.toHaveProperty('claude-sonnet-4-5-20250514');
		});

		it('should show Anthropic models when llmProvider is anthropic', () => {
			mockPlugin.settings.llmProvider = 'anthropic';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmModelSetting = settingInstances.find(s => s.nameEl.textContent === 'Language model');
			expect(llmModelSetting).toBeDefined();

			const dropdown = llmModelSetting!.dropdownComponents[0];
			const options = dropdown!.getOptions();
			expect(options).toHaveProperty('claude-sonnet-4-5-20250514');
			expect(options).toHaveProperty('claude-haiku-4-5-20251001');
			expect(options).not.toHaveProperty('gpt-4o');
		});
	});

	describe('API key validation', () => {
		const mockValidateApiKey = vi.fn<(key: string) => Promise<boolean>>();

		beforeEach(() => {
			mockValidateApiKey.mockReset();
			vi.spyOn(providerRegistry, 'getSTTProvider').mockReturnValue({
				name: 'openai',
				validateApiKey: mockValidateApiKey,
				transcribe: vi.fn(),
				getSupportedModels: vi.fn().mockReturnValue([]),
				setCredentials: vi.fn(),
				getSupportedFormats: vi.fn().mockReturnValue(['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga']),
				getMaxDuration: vi.fn().mockReturnValue(null),
				getRequiredCredentials: vi.fn().mockReturnValue(['apiKey']),
				mapLanguageCode: vi.fn().mockImplementation((lang: string) => lang === 'auto' ? undefined : lang),
			});
			vi.spyOn(providerRegistry, 'getLLMProvider').mockReturnValue({
				name: 'anthropic',
				validateApiKey: mockValidateApiKey,
				summarize: vi.fn(),
				getSupportedModels: vi.fn().mockReturnValue([]),
				setCredentials: vi.fn(),
			});
		});

		it('should have a Test button on STT API key setting', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			expect(sttKeySetting).toBeDefined();
			expect(sttKeySetting!.buttonComponents).toHaveLength(1);
			expect(sttKeySetting!.buttonComponents[0].buttonEl.textContent).toBe('Test');
		});

		it('should have a Test button on LLM API key setting', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Language model API key');
			expect(llmKeySetting).toBeDefined();
			expect(llmKeySetting!.buttonComponents).toHaveLength(1);
			expect(llmKeySetting!.buttonComponents[0].buttonEl.textContent).toBe('Test');
		});

		it('should show ✓ Valid when STT key validation succeeds', async () => {
			mockPlugin.settings.sttApiKey = 'sk-valid-key';
			mockValidateApiKey.mockResolvedValue(true);
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			const button = sttKeySetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(sttKeySetting!.descEl.textContent).toBe('✓ Valid');
			expect(sttKeySetting!.descEl.classList.contains('meeting-scribe-api-status-valid')).toBe(true);
		});

		it('should show ✗ Invalid when STT key validation fails', async () => {
			mockPlugin.settings.sttApiKey = 'sk-bad-key';
			mockValidateApiKey.mockResolvedValue(false);
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			const button = sttKeySetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(sttKeySetting!.descEl.textContent).toBe('✗ Invalid — key not recognized');
			expect(sttKeySetting!.descEl.classList.contains('meeting-scribe-api-status-error')).toBe(true);
		});

		it('should show ✗ Connection failed when validation throws', async () => {
			mockPlugin.settings.sttApiKey = 'sk-network-error';
			mockValidateApiKey.mockRejectedValue(new Error('Network error'));
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			const button = sttKeySetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(sttKeySetting!.descEl.textContent).toBe('✗ Connection failed — check your network');
			expect(sttKeySetting!.descEl.classList.contains('meeting-scribe-api-status-error')).toBe(true);
		});

		it('should show loading state during validation', async () => {
			mockPlugin.settings.sttApiKey = 'sk-valid-key';
			let resolveValidation!: (value: boolean) => void;
			mockValidateApiKey.mockImplementation(() => new Promise(r => { resolveValidation = r; }));
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			const button = sttKeySetting!.buttonComponents[0];

			button.triggerClick();
			// Button should be in loading state immediately
			await flushPromises();
			expect(button.buttonEl.textContent).toBe('Checking...');
			expect(button.buttonEl.disabled).toBe(true);

			// Resolve the validation
			resolveValidation(true);
			await flushPromises();
			expect(button.buttonEl.textContent).toBe('Test');
			expect(button.buttonEl.disabled).toBe(false);
		});

		it('should show error when no API key is entered', async () => {
			mockPlugin.settings.sttApiKey = '';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			const button = sttKeySetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(sttKeySetting!.descEl.textContent).toBe('✗ Enter an API key first');
			expect(sttKeySetting!.descEl.classList.contains('meeting-scribe-api-status-error')).toBe(true);
			expect(mockValidateApiKey).not.toHaveBeenCalled();
		});

		it('should show provider-specific API key URL in STT description', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const sttKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Speech-to-text API key');
			expect(sttKeySetting!.descEl.textContent).toContain('platform.openai.com/api-keys');
		});

		it('should show provider-specific API key URL in LLM description', () => {
			mockPlugin.settings.llmProvider = 'anthropic';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Language model API key');
			expect(llmKeySetting!.descEl.textContent).toContain('console.anthropic.com/settings/keys');
		});

		it('should show OpenAI URL when LLM provider is openai', () => {
			mockPlugin.settings.llmProvider = 'openai';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Language model API key');
			expect(llmKeySetting!.descEl.textContent).toContain('platform.openai.com/api-keys');
		});

		it('should show ✓ Valid when LLM key validation succeeds', async () => {
			mockPlugin.settings.llmApiKey = 'sk-valid-key';
			mockValidateApiKey.mockResolvedValue(true);
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const llmKeySetting = settingInstances.find(s => s.nameEl.textContent === 'Language model API key');
			const button = llmKeySetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(llmKeySetting!.descEl.textContent).toBe('✓ Valid');
			expect(llmKeySetting!.descEl.classList.contains('meeting-scribe-api-status-valid')).toBe(true);
		});
	});

	describe('Test recording button', () => {
		it('should have a Run Test button in test setup section', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			expect(testSetting).toBeDefined();
			expect(testSetting!.buttonComponents).toHaveLength(1);
			expect(testSetting!.buttonComponents[0].buttonEl.textContent).toBe('Run Test');
		});

		it('should show error when API keys are missing', async () => {
			mockPlugin.settings.sttApiKey = '';
			mockPlugin.settings.llmApiKey = '';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			const button = testSetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(testSetting!.descEl.textContent).toBe('✗ Enter API keys first');
			expect(testSetting!.descEl.classList.contains('meeting-scribe-api-status-error')).toBe(true);
			expect(mockPlugin.runTestRecording).not.toHaveBeenCalled();
		});

		it('should call runTestRecording when API keys are present', async () => {
			mockPlugin.settings.sttApiKey = 'sk-stt';
			mockPlugin.settings.llmApiKey = 'sk-llm';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			const button = testSetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(mockPlugin.runTestRecording).toHaveBeenCalled();
		});

		it('should show success result after successful test', async () => {
			mockPlugin.settings.sttApiKey = 'sk-stt';
			mockPlugin.settings.llmApiKey = 'sk-llm';
			mockPlugin.runTestRecording.mockResolvedValue({
				success: true,
				transcriptPreview: 'Hello world test',
				noteFilePath: 'Meeting Notes/test.md',
			});
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			const button = testSetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(testSetting!.descEl.textContent).toBe('✓ Test passed');
			expect(testSetting!.descEl.classList.contains('meeting-scribe-api-status-valid')).toBe(true);
			expect(mockPlugin.noticeManager.showTestSuccess).toHaveBeenCalled();
		});

		it('should show failure result after failed test', async () => {
			mockPlugin.settings.sttApiKey = 'sk-stt';
			mockPlugin.settings.llmApiKey = 'sk-llm';
			mockPlugin.runTestRecording.mockResolvedValue({
				success: false,
				error: 'API rate limit exceeded',
				failedStep: 'transcribing',
			});
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			const button = testSetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(testSetting!.descEl.textContent).toBe('✗ Test failed at transcribing');
			expect(testSetting!.descEl.classList.contains('meeting-scribe-api-status-error')).toBe(true);
		});

		it('should re-enable button after test completes', async () => {
			mockPlugin.settings.sttApiKey = 'sk-stt';
			mockPlugin.settings.llmApiKey = 'sk-llm';
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const testSetting = settingInstances.find(s => s.nameEl.textContent === 'Run test recording');
			const button = testSetting!.buttonComponents[0];

			button.triggerClick();
			await flushPromises();

			expect(button.buttonEl.textContent).toBe('Run Test');
			expect(button.buttonEl.disabled).toBe(false);
		});
	});
});

function collectSettings(containerEl: HTMLElement): Setting[] {
	const settings: Setting[] = [];
	for (let i = 0; i < containerEl.children.length; i++) {
		const child = containerEl.children[i];
		const instance = child && (child as unknown as { _settingInstance?: Setting })._settingInstance;
		if (instance) {
			settings.push(instance);
		}
	}
	return settings;
}

function flushPromises(): Promise<void> {
	return Promise.resolve().then(() => {});
}
