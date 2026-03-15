// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../src/utils/logger';

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
