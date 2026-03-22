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
		expect(result.settingsVersion).toBe(8);
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
		expect(result.settingsVersion).toBe(8);
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
			expect(result.settingsVersion).toBe(8);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
		});

		it('should preserve includeTranscript value if already set in V1 data', () => {
			const v1Data = {
				settingsVersion: 1,
				includeTranscript: false,
			};
			const result = migrateSettings(v1Data);
			expect(result.settingsVersion).toBe(8);
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
			expect(result.settingsVersion).toBe(8);
			expect(result.summaryLanguage).toBe('auto');
		});

		it('should preserve summaryLanguage value if already set in V2 data', () => {
			const v2Data = {
				settingsVersion: 2,
				summaryLanguage: 'ko',
			};
			const result = migrateSettings(v2Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.summaryLanguage).toBe('ko');
		});

		it('should migrate V0 data through all versions with summaryLanguage', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(8);
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
			expect(result.settingsVersion).toBe(8);
			expect(result.onboardingComplete).toBe(false);
		});

		it('should preserve onboardingComplete value if already set in V3 data', () => {
			const v3Data = {
				settingsVersion: 3,
				onboardingComplete: true,
			};
			const result = migrateSettings(v3Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.onboardingComplete).toBe(true);
		});

		it('should migrate V0 data through all versions to V4 with onboardingComplete', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
			expect(result.onboardingComplete).toBe(false);
			expect(result.sttApiKey).toBe('sk-old');
		});
	});

	describe('V4 to V5 migration (enableSmartChunking)', () => {
		it('should add enableSmartChunking: false to V4 settings', () => {
			const v4Data = {
				settingsVersion: 4,
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
				onboardingComplete: false,
			};
			const result = migrateSettings(v4Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.enableSmartChunking).toBe(false);
		});

		it('should preserve enableSmartChunking value if already set in V4 data', () => {
			const v4Data = {
				settingsVersion: 4,
				enableSmartChunking: true,
			};
			const result = migrateSettings(v4Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.enableSmartChunking).toBe(true);
		});

		it('should migrate V0 data through all versions to V5 with enableSmartChunking', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.includeTranscript).toBe(true);
			expect(result.summaryLanguage).toBe('auto');
			expect(result.onboardingComplete).toBe(false);
			expect(result.enableSmartChunking).toBe(false);
			expect(result.sttApiKey).toBe('sk-old');
		});
	});

	describe('V5 to V6 migration (multi-provider fields)', () => {
		it('should add CLOVA, Google, and consent fields to V5 settings', () => {
			const v5Data = {
				settingsVersion: 5,
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
				onboardingComplete: false,
				enableSmartChunking: false,
			};
			const result = migrateSettings(v5Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.clovaInvokeUrl).toBe('');
			expect(result.clovaSecretKey).toBe('');
			expect(result.googleProjectId).toBe('');
			expect(result.googleApiKey).toBe('');
			expect(result.googleLocation).toBe('global');
			expect(result.googleModel).toBe('chirp_3');
			expect(result.showConsentReminder).toBe(true);
			// Existing fields preserved
			expect(result.sttApiKey).toBe('sk-test');
			expect(result.sttProvider).toBe('openai');
		});

		it('should preserve multi-provider values if already set in V5 data', () => {
			const v5Data = {
				settingsVersion: 5,
				clovaInvokeUrl: 'https://custom.ncloud.com/invoke',
				clovaSecretKey: 'my-secret',
				showConsentReminder: false,
			};
			const result = migrateSettings(v5Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.clovaInvokeUrl).toBe('https://custom.ncloud.com/invoke');
			expect(result.clovaSecretKey).toBe('my-secret');
			expect(result.showConsentReminder).toBe(false);
		});

		it('should migrate V0 data through all versions to V8', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.clovaInvokeUrl).toBe('');
			expect(result.googleProjectId).toBe('');
			expect(result.showConsentReminder).toBe(true);
			expect(result.enableSmartChunking).toBe(false);
			expect(result.sttApiKey).toBe('sk-old');
		});
	});

	describe('V6 to V7 migration (separateTranscriptFile)', () => {
		it('should add separateTranscriptFile: false to V6 settings', () => {
			const v6Data = {
				settingsVersion: 6,
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
				onboardingComplete: false,
				enableSmartChunking: false,
				clovaInvokeUrl: '',
				clovaSecretKey: '',
				googleProjectId: '',
				googleApiKey: '',
				googleLocation: 'global',
				googleModel: 'chirp_3',
				showConsentReminder: true,
			};
			const result = migrateSettings(v6Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.separateTranscriptFile).toBe(false);
			// Existing fields preserved
			expect(result.sttApiKey).toBe('sk-test');
			expect(result.showConsentReminder).toBe(true);
		});

		it('should preserve separateTranscriptFile value if already set in V6 data', () => {
			const v6Data = {
				settingsVersion: 6,
				separateTranscriptFile: true,
			};
			const result = migrateSettings(v6Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.separateTranscriptFile).toBe(true);
		});

		it('should migrate V0 data through all versions to V7 with separateTranscriptFile', () => {
			const v0Data = { sttApiKey: 'sk-old' };
			const result = migrateSettings(v0Data);
			expect(result.settingsVersion).toBe(8);
			expect(result.separateTranscriptFile).toBe(false);
			expect(result.showConsentReminder).toBe(true);
			expect(result.enableSmartChunking).toBe(false);
			expect(result.sttApiKey).toBe('sk-old');
		});
	});
});
