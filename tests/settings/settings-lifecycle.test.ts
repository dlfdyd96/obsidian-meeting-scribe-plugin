// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { logger } from '../../src/utils/logger';
import { providerRegistry } from '../../src/providers/provider-registry';

describe('MeetingScribePlugin settings lifecycle', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		(providerRegistry as any).sttProviders = new Map();
		(providerRegistry as any).llmProviders = new Map();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should load and migrate settings in onload()', async () => {
		const { default: MeetingScribePlugin } = await import('../../src/main');
		const plugin = new MeetingScribePlugin();

		// Mock loadData to return partial settings
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test' });

		await plugin.onload();

		expect(plugin.settings).toBeDefined();
		expect(plugin.settings.sttApiKey).toBe('sk-test');
		expect(plugin.settings.settingsVersion).toBe(1);
		expect(plugin.settings.sttProvider).toBe('openai');
	});

	it('should use DEFAULT_SETTINGS when loadData returns null', async () => {
		const { default: MeetingScribePlugin } = await import('../../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);

		await plugin.onload();

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('should wire debugMode to logger', async () => {
		const { default: MeetingScribePlugin } = await import('../../src/main');
		const plugin = new MeetingScribePlugin();

		const setDebugSpy = vi.spyOn(logger, 'setDebugMode');
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ debugMode: true });

		await plugin.onload();

		expect(setDebugSpy).toHaveBeenCalledWith(true);
	});

	it('should have a saveSettings method that calls saveData', async () => {
		const { default: MeetingScribePlugin } = await import('../../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		const saveSpy = vi.spyOn(plugin, 'saveData').mockResolvedValue();

		await plugin.onload();
		await plugin.saveSettings();

		expect(saveSpy).toHaveBeenCalledWith(plugin.settings);
	});
});
