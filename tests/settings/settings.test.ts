import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, CURRENT_SETTINGS_VERSION } from '../../src/settings/settings';
import type { MeetingScribeSettings } from '../../src/settings/settings';

describe('MeetingScribeSettings', () => {
	describe('CURRENT_SETTINGS_VERSION', () => {
		it('should be 8', () => {
			expect(CURRENT_SETTINGS_VERSION).toBe(8);
		});
	});

	describe('DEFAULT_SETTINGS', () => {
		it('should have settingsVersion set to 8', () => {
			expect(DEFAULT_SETTINGS.settingsVersion).toBe(8);
		});

		it('should have sttProvider set to openai', () => {
			expect(DEFAULT_SETTINGS.sttProvider).toBe('openai');
		});

		it('should have sttApiKey set to empty string', () => {
			expect(DEFAULT_SETTINGS.sttApiKey).toBe('');
		});

		it('should have sttModel set to gpt-4o-mini-transcribe', () => {
			expect(DEFAULT_SETTINGS.sttModel).toBe('gpt-4o-mini-transcribe');
		});

		it('should have sttLanguage set to auto', () => {
			expect(DEFAULT_SETTINGS.sttLanguage).toBe('auto');
		});

		it('should have llmProvider set to anthropic', () => {
			expect(DEFAULT_SETTINGS.llmProvider).toBe('anthropic');
		});

		it('should have llmApiKey set to empty string', () => {
			expect(DEFAULT_SETTINGS.llmApiKey).toBe('');
		});

		it('should have llmModel set to empty string', () => {
			expect(DEFAULT_SETTINGS.llmModel).toBe('');
		});

		it('should have outputFolder set to Meeting Notes', () => {
			expect(DEFAULT_SETTINGS.outputFolder).toBe('Meeting Notes');
		});

		it('should have audioFolder set to _attachments/audio', () => {
			expect(DEFAULT_SETTINGS.audioFolder).toBe('_attachments/audio');
		});

		it('should have audioRetentionPolicy set to keep', () => {
			expect(DEFAULT_SETTINGS.audioRetentionPolicy).toBe('keep');
		});

		it('should have includeTranscript set to true', () => {
			expect(DEFAULT_SETTINGS.includeTranscript).toBe(true);
		});

		it('should have summaryLanguage set to auto', () => {
			expect(DEFAULT_SETTINGS.summaryLanguage).toBe('auto');
		});

		it('should have debugMode set to false', () => {
			expect(DEFAULT_SETTINGS.debugMode).toBe(false);
		});

		it('should have enableSmartChunking set to false', () => {
			expect(DEFAULT_SETTINGS.enableSmartChunking).toBe(false);
		});

		it('should have onboardingComplete set to false', () => {
			expect(DEFAULT_SETTINGS.onboardingComplete).toBe(false);
		});

		it('should have exactly 24 fields', () => {
			expect(Object.keys(DEFAULT_SETTINGS)).toHaveLength(24);
		});

		it('should have CLOVA Speech defaults', () => {
			expect(DEFAULT_SETTINGS.clovaInvokeUrl).toBe('');
			expect(DEFAULT_SETTINGS.clovaSecretKey).toBe('');
		});

		it('should have Google Cloud STT defaults', () => {
			expect(DEFAULT_SETTINGS.googleProjectId).toBe('');
			expect(DEFAULT_SETTINGS.googleApiKey).toBe('');
			expect(DEFAULT_SETTINGS.googleLocation).toBe('global');
			expect(DEFAULT_SETTINGS.googleModel).toBe('chirp_3');
		});

		it('should have showConsentReminder set to true', () => {
			expect(DEFAULT_SETTINGS.showConsentReminder).toBe(true);
		});

		it('should satisfy the MeetingScribeSettings type', () => {
			const settings: MeetingScribeSettings = DEFAULT_SETTINGS;
			expect(settings).toBeDefined();
		});
	});
});
