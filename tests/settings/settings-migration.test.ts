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

	it('should return DEFAULT_SETTINGS with settingsVersion 1 when given empty object', () => {
		const result = migrateSettings({});
		expect(result).toEqual({ ...DEFAULT_SETTINGS, settingsVersion: 1 });
	});

	it('should merge partial data with defaults (sttApiKey set)', () => {
		const result = migrateSettings({ sttApiKey: 'sk-123' });
		expect(result.sttApiKey).toBe('sk-123');
		expect(result.sttProvider).toBe('openai');
		expect(result.settingsVersion).toBe(1);
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
		expect(result.settingsVersion).toBe(1);
		expect(result.sttProvider).toBe('whisper');
	});

	it('should return a new object, not a reference to DEFAULT_SETTINGS', () => {
		const result = migrateSettings(null);
		expect(result).not.toBe(DEFAULT_SETTINGS);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});
});
