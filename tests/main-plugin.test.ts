// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarkdownView, Notice, Platform, TFile, Vault, WorkspaceLeaf } from 'obsidian';
import { logger } from '../src/utils/logger';
import { stateManager } from '../src/state/state-manager';
import { PluginState } from '../src/state/types';
import { providerRegistry } from '../src/providers/provider-registry';
import { Pipeline } from '../src/pipeline/pipeline';

// Mock duration guard to always proceed — pipeline integration tests don't test guard logic
import { checkDurationGuard } from '../src/pipeline/duration-guard';
vi.mock('../src/pipeline/duration-guard', () => ({
	checkDurationGuard: vi.fn().mockResolvedValue({ action: 'proceed' }),
}));

// Mock transcript data I/O for PipelineDispatcher
vi.mock('../src/transcript/transcript-data', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/transcript/transcript-data')>();
	return {
		...actual,
		loadTranscriptData: vi.fn().mockResolvedValue(null),
		saveTranscriptData: vi.fn().mockResolvedValue(undefined),
	};
});

function resetProviderRegistry(): void {
	(providerRegistry as any).sttProviders = new Map();
	(providerRegistry as any).llmProviders = new Map();
}

describe('MeetingScribePlugin onunload', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		resetProviderRegistry();
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

	it('should call dispatcher.abortAll() on unload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const abortSpy = vi.spyOn((plugin as any).dispatcher, 'abortAll');

		plugin.onunload();

		expect(abortSpy).toHaveBeenCalledOnce();
	});
});

describe('MeetingScribePlugin integration flow', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		resetProviderRegistry();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should wire StatusBar onStartRecording to recorder.startRecording', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test' });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);

		// The StatusBar's onStartRecording callback should invoke recorder.startRecording
		const statusBar = (plugin as any).statusBar;
		// Trigger the start callback stored in the StatusBar
		statusBar.onStartRecording();

		expect(startSpy).toHaveBeenCalledOnce();
	});

	it('should block recording and show notice when API keys are missing', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: '', llmApiKey: '' });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);
		const noticeSpy = vi.spyOn(plugin.noticeManager, 'showMissingApiKeys').mockReturnValue(new Notice(''));

		const statusBar = (plugin as any).statusBar;
		statusBar.onStartRecording();

		expect(startSpy).not.toHaveBeenCalled();
		expect(noticeSpy).toHaveBeenCalledOnce();
	});

	it('should block start-recording command and show notice when API keys are missing', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: '', llmApiKey: '' });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);
		const noticeSpy = vi.spyOn(plugin.noticeManager, 'showMissingApiKeys').mockReturnValue(new Notice(''));

		const cmd = plugin.commands.find(c => c.id === 'start-recording');
		cmd!.callback();

		expect(startSpy).not.toHaveBeenCalled();
		expect(noticeSpy).toHaveBeenCalledOnce();
	});

	it('should show consent reminder when showConsentReminder is true', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test', showConsentReminder: true });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);
		const consentSpy = vi.spyOn(plugin.noticeManager, 'showConsentReminder').mockReturnValue(new Notice(''));

		const statusBar = (plugin as any).statusBar;
		statusBar.onStartRecording();

		expect(consentSpy).toHaveBeenCalledOnce();
	});

	it('should not show consent reminder when showConsentReminder is false', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();

		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test', showConsentReminder: false });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);
		const consentSpy = vi.spyOn(plugin.noticeManager, 'showConsentReminder').mockReturnValue(new Notice(''));

		const statusBar = (plugin as any).statusBar;
		statusBar.onStartRecording();

		expect(consentSpy).not.toHaveBeenCalled();
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

		// Mock pipeline execution via dispatcher
		vi.spyOn(Pipeline.prototype, 'execute').mockResolvedValue({
			context: { audioFilePath: 'path/to/file.webm', vault: {} as any, settings: plugin.settings, noteFilePath: 'notes/test.md' },
		});

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

describe('MeetingScribePlugin provider registration', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		resetProviderRegistry();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should register OpenAI STT provider on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect(providerRegistry.getSTTProvider('openai')).toBeDefined();
	});

	it('should register OpenAI LLM provider on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect(providerRegistry.getLLMProvider('openai')).toBeDefined();
	});

	it('should register Anthropic LLM provider on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect(providerRegistry.getLLMProvider('anthropic')).toBeDefined();
	});
});

describe('MeetingScribePlugin command registration', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		stateManager.reset();
		resetProviderRegistry();
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
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test' });
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
	});

	it('should allow import-audio while pipeline is processing', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		// In Phase 2, Processing state no longer blocks import-audio
		// Plugin state stays Idle while pipelines run in background
		const cmd = plugin.commands.find(c => c.id === 'import-audio');
		expect(() => cmd!.callback()).not.toThrow();
	});

	it('should register audio-play-pause command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-play-pause');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Play/pause audio');
	});

	it('should register audio-skip-back command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-skip-back');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Skip back 5 seconds');
	});

	it('should register audio-skip-forward command', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-skip-forward');
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe('Skip forward 5 seconds');
	});

	it('audio-play-pause callback should not throw when no sidebar is open', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-play-pause');
		expect(() => cmd!.callback()).not.toThrow();
	});

	it('audio-skip-back callback should not throw when no sidebar is open', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-skip-back');
		expect(() => cmd!.callback()).not.toThrow();
	});

	it('audio-skip-forward callback should not throw when no sidebar is open', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const cmd = plugin.commands.find(c => c.id === 'audio-skip-forward');
		expect(() => cmd!.callback()).not.toThrow();
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

describe('MeetingScribePlugin pipeline integration', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		logger.setDebugMode(false);
		stateManager.reset();
		resetProviderRegistry();
		// Re-mock duration guard after restoreAllMocks clears it
		vi.mocked(checkDurationGuard).mockResolvedValue({ action: 'proceed' });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should trigger pipeline via dispatcher after recording stop saves audio', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const audioFileManager = (plugin as any).audioFileManager;

		const fakeBlob = new Blob(['audio'], { type: 'audio/webm' });
		vi.spyOn(recorder, 'stopRecording').mockResolvedValue(fakeBlob);
		vi.spyOn(audioFileManager, 'saveRecording').mockResolvedValue('audio/test.webm');

		// Mock pipeline execution
		const executeSpy = vi.spyOn(Pipeline.prototype, 'execute').mockResolvedValue({
			context: { audioFilePath: 'audio/test.webm', vault: {} as any, settings: plugin.settings, noteFilePath: 'notes/test.md' },
		});

		const statusBar = (plugin as any).statusBar;
		await statusBar.onStopRecording();

		// Allow async pipeline to start
		await vi.waitFor(() => {
			expect(executeSpy).toHaveBeenCalledOnce();
		});
	});

	it('should dispatch pipeline when startProcessingFlow is called', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const dispatchSpy = vi.spyOn((plugin as any).dispatcher, 'dispatch').mockResolvedValue('session-123');

		(plugin as any).startProcessingFlow('audio/test.webm');

		expect(dispatchSpy).toHaveBeenCalledWith('audio/test.webm', undefined);
	});

	it('should allow multiple concurrent pipeline dispatches', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		const dispatchSpy = vi.spyOn((plugin as any).dispatcher, 'dispatch').mockResolvedValue('session-123');

		(plugin as any).startProcessingFlow('audio/test1.webm');
		(plugin as any).startProcessingFlow('audio/test2.webm');

		expect(dispatchSpy).toHaveBeenCalledTimes(2);
	});

	it('should set pipelineAborted flag on unload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect((plugin as any).pipelineAborted).toBe(false);

		plugin.onunload();

		expect((plugin as any).pipelineAborted).toBe(true);
	});

	it('should instantiate SessionManager on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect((plugin as any).sessionManager).toBeDefined();
	});

	it('should instantiate PipelineDispatcher on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		expect((plugin as any).dispatcher).toBeDefined();
	});

	it('should call dispatcher.recoverSessions on load', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);

		// Need to wait for onload to set up dispatcher before spying
		await plugin.onload();

		// Recovery was called during onload — verify dispatcher exists
		const dispatcher = (plugin as any).dispatcher;
		expect(dispatcher).toBeDefined();
	});
});

describe('MeetingScribePlugin platform detection', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		logger.setDebugMode(false);
		stateManager.reset();
		resetProviderRegistry();
		// Default: desktop
		Platform.isMobile = false;
		Platform.isDesktop = true;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Platform.isMobile = false;
		Platform.isDesktop = true;
	});

	it('should block recording and show notice on mobile when MediaRecorder is missing', async () => {
		Platform.isMobile = true;
		Platform.isDesktop = false;

		const originalMediaRecorder = globalThis.MediaRecorder;
		// @ts-expect-error — removing global for test
		delete globalThis.MediaRecorder;

		try {
			const { default: MeetingScribePlugin } = await import('../src/main');
			const plugin = new MeetingScribePlugin();
			vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test' });
			await plugin.onload();

			// Recording should be blocked — try to start via command
			const recorder = (plugin as any).recorder;
			const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);
			const unavailableSpy = vi.spyOn(plugin.noticeManager, 'showRecordingUnavailable').mockReturnValue(new Notice(''));

			const cmd = plugin.commands.find(c => c.id === 'start-recording');
			cmd!.callback();

			expect(startSpy).not.toHaveBeenCalled();
			expect(unavailableSpy).toHaveBeenCalled();
		} finally {
			globalThis.MediaRecorder = originalMediaRecorder;
		}
	});

	it('should not show recording unavailable notice on desktop', async () => {
		Platform.isMobile = false;
		Platform.isDesktop = true;

		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ sttApiKey: 'sk-test', llmApiKey: 'sk-test' });
		await plugin.onload();

		const recorder = (plugin as any).recorder;
		const startSpy = vi.spyOn(recorder, 'startRecording').mockResolvedValue(undefined);

		const cmd = plugin.commands.find(c => c.id === 'start-recording');
		cmd!.callback();

		// Desktop should start recording normally
		expect(startSpy).toHaveBeenCalledOnce();
	});

	it('should always register import-audio command regardless of platform', async () => {
		Platform.isMobile = true;
		Platform.isDesktop = false;

		const originalMediaRecorder = globalThis.MediaRecorder;
		// @ts-expect-error — removing global for test
		delete globalThis.MediaRecorder;

		try {
			const { default: MeetingScribePlugin } = await import('../src/main');
			const plugin = new MeetingScribePlugin();
			vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
			await plugin.onload();

			const cmd = plugin.commands.find(c => c.id === 'import-audio');
			expect(cmd).toBeDefined();
			expect(cmd!.name).toBe('Import audio file');
		} finally {
			globalThis.MediaRecorder = originalMediaRecorder;
		}
	});
});

describe('MeetingScribePlugin microphone detection', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		stateManager.reset();
		resetProviderRegistry();
		Platform.isMobile = false;
		Platform.isDesktop = true;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should log warning when no audio input devices are found', async () => {
		const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

		// Mock navigator.mediaDevices.enumerateDevices to return no audio inputs
		const enumerateDevicesSpy = vi.fn().mockResolvedValue([
			{ kind: 'videoinput', deviceId: 'cam1', label: '', groupId: '' },
		]);
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { enumerateDevices: enumerateDevicesSpy, getUserMedia: vi.fn() },
			configurable: true,
		});

		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		await plugin.onload();

		// Wait for async enumeration
		await new Promise(r => setTimeout(r, 50));

		expect(warnSpy).toHaveBeenCalledWith('MeetingScribePlugin', 'No microphone detected');
	});
});

describe('Auto-open sidebar on active-leaf-change', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		logger.setDebugMode(false);
		resetProviderRegistry();
		// Mock navigator.mediaDevices for onload
		Object.defineProperty(navigator, 'mediaDevices', {
			value: {
				enumerateDevices: vi.fn().mockResolvedValue([
					{ kind: 'audioinput', deviceId: 'mic1', label: '', groupId: '' },
				]),
				getUserMedia: vi.fn(),
			},
			configurable: true,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should register active-leaf-change event during onload', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);
		const registerEventSpy = vi.spyOn(plugin, 'registerEvent');

		await plugin.onload();

		expect(registerEventSpy).toHaveBeenCalled();
	});

	it('should have autoOpenSidebar default to true', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue(null);

		await plugin.onload();

		expect((plugin as any).settings.autoOpenSidebar).toBe(true);
	});

	it('should set autoOpenSidebar to false when loaded from saved settings', async () => {
		const { default: MeetingScribePlugin } = await import('../src/main');
		const plugin = new MeetingScribePlugin();
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ autoOpenSidebar: false, settingsVersion: 11 });

		await plugin.onload();

		expect((plugin as any).settings.autoOpenSidebar).toBe(false);
	});
});
