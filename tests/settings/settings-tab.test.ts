// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { MeetingScribeSettingTab } from '../../src/settings/settings-tab';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import type { MeetingScribeSettings } from '../../src/settings/settings';
import { logger } from '../../src/utils/logger';

vi.spyOn(console, 'debug').mockImplementation(() => {});

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

		it('should create all 4 section headings', () => {
			tab.display();
			const settingInstances = collectSettings(tab.containerEl);
			const headings = settingInstances.filter(s => s.isHeading());
			expect(headings).toHaveLength(3);
			expect(headings.map(h => h.getName())).toEqual([
				'API configuration',
				'Output',
				'Recording',
			]);
			// 4th section is the <details> Advanced section
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
	return new Promise(resolve => setTimeout(resolve, 0));
}
