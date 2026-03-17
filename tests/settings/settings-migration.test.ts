import { describe, it, expect } from 'vitest';
import { migrateSettings } from '../../src/settings/settings-migration';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

describe('migrateSettings', () => {
	it('should return DEFAULT_SETTINGS when given null', () => {
		const result = migrateSettings(null);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it('should return DEFAULT_SETTINGS when given undefined', () => {
		const result = migrateSettings(undefined);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it('should return DEFAULT_SETTINGS with current version when given empty object', () => {
		const result = migrateSettings({});
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it('should merge partial data with defaults (sttApiKey set)', () => {
		const result = migrateSettings({ sttApiKey: 'sk-123' });
		expect(result.sttApiKey).toBe('sk-123');
		expect(result.sttProvider).toBe('openai');
		expect(result.settingsVersion).toBe(4);
		expect(result.llmProvider).toBe('anthropic');
	});

	it('should preserve valid v1 settings unchanged', () => {
		const result = migrateSettings({ ...DEFAULT_SETTINGS });
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it('should preserve all provided values and fill rest with defaults', () => {
		const partial = {
			settingsVersion: 1,
			sttApiKey: 'sk-123',
			llmApiKey: 'key-456',
			outputFolder: 'Notes',
		};
		const result = migrateSettings(partial);
		expect(result.sttApiKey).toBe('sk-123');
		expect(result.llmApiKey).toBe('key-456');
		expect(result.outputFolder).toBe('Notes');
		expect(result.sttProvider).toBe('openai');
		expect(result.audioRetentionPolicy).toBe('keep');
		expect(result.debugMode).toBe(false);
	});

	it('should handle future version gracefully (settingsVersion > current)', () => {
		const futureData = { ...DEFAULT_SETTINGS, settingsVersion: 99 };
		const result = migrateSettings(futureData);
		expect(result.settingsVersion).toBe(99);
		expect(result.sttProvider).toBe('openai');
	});

	it('should treat data without settingsVersion as version 0', () => {
		const result = migrateSettings({ sttProvider: 'whisper' });
		expect(result.settingsVersion).toBe(4);
		expect(result.sttProvider).toBe('whisper');
	});

	it('should return a new object, not a reference to DEFAULT_SETTINGS', () => {
		const result = migrateSettings(null);
		expect(result).not.toBe(DEFAULT_SETTINGS);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	describe('V1 to V2 migration (includeTranscript)', () => {
		it('should add includeTranscript: true to V1 settings and migrate through to V3', () => {
			const v1Data = {
				settingsVersion: 1,
				sttProvider: 'openai',
				sttApiKey: 'sk-test',
				sttModel: 'gpt-4o-mini-transcribe',
				sttLanguage: 'auto',
				llmProvider: 'anthropic',
				llmApiKey: 'key-test',
				llmModel: '',
				outputFolder: 'Meeting Notes',
				audioFolder: '_attachments/audio',
				audioRetentionPolicy: 'keep',
				debugMode: false,
			};
			const result = migrateSettings(v1Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
		});

		it('should preserve includeTranscript value if already set in V1 data', () => {
			const v1Data = {
				settingsVersion: 1,
				includeTranscript: false,
			};
			const result = migrateSettings(v1Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.includeTranscript).toBe(false);
		});
	});

	describe('V2 to V3 migration (summaryLanguage)', () => {
		it('should add summaryLanguage: auto to V2 settings', () => {
			const v2Data = {
				settingsVersion: 2,
				sttProvider: 'openai',
				sttApiKey: 'sk-test',
				sttModel: 'gpt-4o-mini-transcribe',
				sttLanguage: 'auto',
				llmProvider: 'anthropic',
				llmApiKey: 'key-test',
				llmModel: '',
				outputFolder: 'Meeting Notes',
				audioFolder: '_attachments/audio',
				audioRetentionPolicy: 'keep',
				includeTranscript: true,
				debugMode: false,
			};
			const result = migrateSettings(v2Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.summaryLanguage).toBe('auto');
		});

		it('should preserve summaryLanguage value if already set in V2 data', () => {
			const v2Data = {
				settingsVersion: 2,
				summaryLanguage: 'ko',
			};
			const result = migrateSettings(v2Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.summaryLanguage).toBe('ko');
		});

		it('should migrate V0 data through all versions with summaryLanguage', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
			expect(result.sttApiKey).toBe('sk-old');
		});
	});

	describe('V3 to V4 migration (onboardingComplete)', () => {
		it('should add onboardingComplete: false to V3 settings', () => {
			const v3Data = {
				settingsVersion: 3,
				sttProvider: 'openai',
				sttApiKey: 'sk-test',
				sttModel: 'gpt-4o-mini-transcribe',
				sttLanguage: 'auto',
				llmProvider: 'anthropic',
				llmApiKey: 'key-test',
				llmModel: '',
				outputFolder: 'Meeting Notes',
				audioFolder: '_attachments/audio',
				audioRetentionPolicy: 'keep',
				includeTranscript: true,
				summaryLanguage: 'auto',
				debugMode: false,
			};
			const result = migrateSettings(v3Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.onboardingComplete).toBe(false);
		});

		it('should preserve onboardingComplete value if already set in V3 data', () => {
			const v3Data = {
				settingsVersion: 3,
				onboardingComplete: true,
			};
			const result = migrateSettings(v3Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.onboardingComplete).toBe(true);
		});

		it('should migrate V0 data through all versions to V4 with onboardingComplete', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(4);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
			expect(result.onboardingComplete).toBe(false);
			expect(result.sttApiKey).toBe('sk-old');
		});
	});
});
