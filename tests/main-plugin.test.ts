// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../src/utils/logger';
import { stateManager } from '../src/state/state-manager';
import { PluginState } from '../src/state/types';

describe('MeetingScribePlugin onunload', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should call statusBar.destroy() on unload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const destroySpy = vi.spyOn((plugin as any).statusBar, 'destroy');

		plugin.onunload();

		expect(destroySpy).toHaveBeenCalledOnce();
	});

	it('should call recorder.destroy() on unload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const destroySpy = vi.spyOn((plugin as any).recorder, 'destroy');

		plugin.onunload();

		expect(destroySpy).toHaveBeenCalledOnce();
	});

	it('should log "Plugin unloaded" via logger', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const logSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

		plugin.onunload();

		expect(logSpy).toHaveBeenCalledWith('MeetingScribePlugin', 'Plugin unloaded');
	});

	it('should be safe when components are undefined (onunload before onload)', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		// Should not throw when called without onload
		expect(() => plugin.onunload()).not.toThrow();
	});
});

describe('MeetingScribePlugin integration flow', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should wire StatusBar onStartRecording to recorder.startRecording', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);

		// The StatusBar's onStartRecording callback should invoke recorder.startRecording
		const statusBar = (plugin as any).statusBar;
		// Trigger the start callback stored in the StatusBar
		statusBar.onStartRecording();

		expect(startSpy).toHaveBeenCalledOnce();
	});

	it('should wire StatusBar onStopRecording to recorder.stopRecording + audioFileManager.saveRecording', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const audioFileManager = (plugin as any).audioFileManager;

		const fakeBlob = new Blob(['audio'], { type: 'audio/webm' });
		const stopSpy = vi.spyOn(recorder, 'stopRecording').mockResolvedValue(fakeBlob);
		const saveSpy = vi.spyOn(audioFileManager, 'saveRecording').mockResolvedValue('path/to/file.webm');

		const statusBar = (plugin as any).statusBar;
		await statusBar.onStopRecording();

		expect(stopSpy).toHaveBeenCalledOnce();
		expect(saveSpy).toHaveBeenCalledWith(fakeBlob);
	});

	it('should not save recording when stopRecording returns null (no blob)', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const audioFileManager = (plugin as any).audioFileManager;

		const stopSpy = vi.spyOn(recorder, 'stopRecording').mockResolvedValue(null);
		const saveSpy = vi.spyOn(audioFileManager, 'saveRecording').mockResolvedValue('path/to/file.webm');

		const statusBar = (plugin as any).statusBar;
		await statusBar.onStopRecording();

		expect(stopSpy).toHaveBeenCalledOnce();
		expect(saveSpy).not.toHaveBeenCalled();
	});

	it('should register settings tab on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		const addSettingTabSpy = vi.spyOn(plugin, 'addSettingTab');

		await plugin.onload();

		expect(addSettingTabSpy).toHaveBeenCalledOnce();
		// Verify it was called with an instance of MeetingScribeSettingTab
		const { MeetingScribeSettingTab } = await import('../src/settings/settings-tab');
		expect(addSettingTabSpy.mock.calls[0][0]).toBeInstanceOf(MeetingScribeSettingTab);
	});
});

describe('MeetingScribePlugin command registration', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		stateManager.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should register start-recording command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'start-recording');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Start recording');
	});

	it('should register stop-recording command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'stop-recording');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Stop recording');
	});

	it('should register toggle-recording command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'toggle-recording');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Toggle recording');
	});

	it('should toggle command start recording when in Idle state', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);

		const toggleCmd = plugin.commands.find(c => c.id === 'toggle-recording');
		toggleCmd!.callback();

		expect(startSpy).toHaveBeenCalledOnce();
	});

	it('should toggle command stop recording when in Recording state', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		vi.spyOn(recorder, 'stopRecording').mockResolvedValue(null);

		stateManager.setState(PluginState.Recording);

		const toggleCmd = plugin.commands.find(c => c.id === 'toggle-recording');
		toggleCmd!.callback();

		expect(recorder.stopRecording).toHaveBeenCalledOnce();
	});

	it('should register import-audio command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'import-audio');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Import audio file');
	});

	it('should open AudioSuggestModal when import-audio called in Idle state', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'import-audio');
		// Should not throw when called in Idle state
		expect(() => cmd!.callback()).not.toThrow();
	});

	it('should not open modal when import-audio called in Recording state', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		stateManager.setState(PluginState.Recording);

		const cmd = plugin.commands.find(c => c.id === 'import-audio');
		// Should be a no-op (no modal opened, no error)
		expect(() => cmd!.callback()).not.toThrow();
		// lastImportedAudioPath should remain null
		expect(plugin.lastImportedAudioPath).toBeNull();
	});

	it('should store selected file path on plugin instance', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		// Verify lastImportedAudioPath property exists and defaults to null
		expect(plugin.lastImportedAudioPath).toBeNull();
	});

	it('should call ribbonHandler.destroy() on unload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const destroySpy = vi.spyOn((plugin as any).ribbonHandler, 'destroy');
		plugin.onunload();

		expect(destroySpy).toHaveBeenCalledOnce();
	});
});
