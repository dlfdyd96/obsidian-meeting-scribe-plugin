import { Notice, Platform, Plugin, TFile } from 'obsidian';
import { migrateSettings } from './settings/settings-migration';
import { MeetingScribeSettingTab } from './settings/settings-tab';
import { Recorder } from './recording/recorder';
import { AudioFileManager } from './recording/audio-file-manager';
import { StatusBar } from './ui/status-bar';
import { RibbonHandler } from './ui/ribbon-handler';
import { AudioSuggestModal } from './ui/audio-suggest-modal';
import { stateManager } from './state/state-manager';
import { PluginState } from './state/types';
import { NoticeManager } from './ui/notices';
import { Pipeline } from './pipeline/pipeline';
import { TranscribeStep } from './pipeline/steps/transcribe-step';
import { SummarizeStep } from './pipeline/steps/summarize-step';
import { GenerateNoteStep } from './pipeline/steps/generate-note-step';
import { providerRegistry } from './providers/provider-registry';
import { OpenAISTTProvider } from './providers/stt/openai-stt-provider';
import { OpenAILLMProvider } from './providers/llm/openai-llm-provider';
import { AnthropicLLMProvider } from './providers/llm/anthropic-llm-provider';
import { PLUGIN_ID, PLUGIN_NAME, NOTICE_RETRY_TIMEOUT_MS, TEST_RECORDING_DURATION_MS } from './constants';
import { logger } from './utils/logger';
import type { MeetingScribeSettings } from './settings/settings';
import type { PipelineContext } from './pipeline/pipeline-types';

const COMPONENT = 'MeetingScribePlugin';

export interface TestRecordingResult {
	success: boolean;
	transcriptPreview?: string;
	noteFilePath?: string;
	error?: string;
	failedStep?: string;
}

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;
	private recorder!: Recorder;
	private audioFileManager!: AudioFileManager;
	private statusBar!: StatusBar;
	private ribbonHandler!: RibbonHandler;
	noticeManager!: NoticeManager;
	private lastPipelineAudioPath: string | null = null;
	private pipelineAborted = false;
	private recordingAvailable = true;

	async onload() {
		const data: unknown = await this.loadData();
		this.settings = migrateSettings(data);
		logger.setDebugMode(this.settings.debugMode);
		this.addSettingTab(new MeetingScribeSettingTab(this.app, this));

		providerRegistry.registerSTTProvider(new OpenAISTTProvider());
		providerRegistry.registerLLMProvider(new OpenAILLMProvider());
		providerRegistry.registerLLMProvider(new AnthropicLLMProvider());

		this.recorder = new Recorder(stateManager);
		this.audioFileManager = new AudioFileManager(
			this.app.vault,
			() => this.settings.audioFolder,
		);

		const startRecordingFlow = (): void => {
			if (!this.recordingAvailable) {
				this.noticeManager.showRecordingUnavailable();
				return;
			}
			if (!this.settings.sttApiKey || !this.settings.llmApiKey) {
				this.noticeManager.showMissingApiKeys();
				return;
			}
			void this.recorder.startRecording();
		};

		const stopRecordingFlow = (): void => {
			void (async () => {
				try {
					const blob = await this.recorder.stopRecording();
					if (blob) {
						const audioPath = await this.audioFileManager.saveRecording(blob);
						this.startProcessingFlow(audioPath);
					}
				} catch (err) {
					logger.error(COMPONENT, 'Failed to save recording', { error: (err as Error).message });
				}
			})();
		};

		this.noticeManager = new NoticeManager(
			this.app,
			() => {
				if (this.lastPipelineAudioPath) {
					this.startProcessingFlow(this.lastPipelineAudioPath);
				}
			},
			PLUGIN_ID,
		);

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(
			statusBarEl,
			stateManager,
			startRecordingFlow,
			stopRecordingFlow,
			(path: string) => {
				void this.app.workspace.openLinkText(path, '', false);
			},
			(error: Error, step?: string) => {
				this.noticeManager.showError(step ?? 'Processing', error);
			},
		);

		const ribbonEl = this.addRibbonIcon('mic', `${PLUGIN_NAME}: Start Recording`, () => {
			// Initial callback — RibbonHandler takes over click behavior
		});
		this.ribbonHandler = new RibbonHandler(
			ribbonEl,
			stateManager,
			startRecordingFlow,
			stopRecordingFlow,
		);

		this.addCommand({
			id: 'start-recording',
			name: 'Start recording',
			callback: () => {
				const state = stateManager.getState();
				if (state === PluginState.Idle || state === PluginState.Error) {
					if (state === PluginState.Error) stateManager.setState(PluginState.Idle);
					startRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'stop-recording',
			name: 'Stop recording',
			callback: () => {
				if (stateManager.getState() === PluginState.Recording) {
					stopRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'toggle-recording',
			name: 'Toggle recording',
			callback: () => {
				const state = stateManager.getState();
				if (state === PluginState.Idle || state === PluginState.Error) {
					if (state === PluginState.Error) stateManager.setState(PluginState.Idle);
					startRecordingFlow();
				} else if (state === PluginState.Recording) {
					stopRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'import-audio',
			name: 'Import audio file',
			callback: () => {
				const state = stateManager.getState();
				if (state === PluginState.Idle || state === PluginState.Error) {
					if (state === PluginState.Error) stateManager.setState(PluginState.Idle);
					const modal = new AudioSuggestModal(this.app, (filePath: string) => {
						this.startProcessingFlow(filePath);
					});
					modal.open();
				}
			},
		});

		if (Platform.isMobile && (typeof MediaRecorder === 'undefined')) {
			this.recordingAvailable = false;
			this.noticeManager.showRecordingUnavailable();
		}

		// Passive microphone availability check (non-blocking, warning only)
		void navigator.mediaDevices?.enumerateDevices().then(devices => {
			const hasMic = devices.some(d => d.kind === 'audioinput');
			if (!hasMic) {
				logger.warn(COMPONENT, 'No microphone detected');
			}
		}).catch(() => {
			logger.warn(COMPONENT, 'Could not enumerate media devices');
		});

		if (!this.settings.onboardingComplete && this.settings.sttApiKey === '' && this.settings.llmApiKey === '') {
			this.app.workspace.onLayoutReady(() => {
				this.noticeManager.showWelcome();
				const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
				setting.open();
				setting.openTabById(PLUGIN_ID);
			});
			this.settings.onboardingComplete = true;
			void this.saveSettings();
		}

		logger.debug(COMPONENT, 'Plugin loaded');
	}

	private startProcessingFlow(audioFilePath: string): void {
		if (stateManager.getState() === PluginState.Processing) {
			new Notice('Processing in progress — please wait', NOTICE_RETRY_TIMEOUT_MS);
			return;
		}
		this.lastPipelineAudioPath = audioFilePath;
		void this.executePipeline(audioFilePath);
	}

	private async executePipeline(audioFilePath: string): Promise<void> {
		this.pipelineAborted = false;

		const context: PipelineContext = {
			audioFilePath,
			vault: this.app.vault,
			settings: this.settings,
			onProgress: (step: string, current: number, total: number) => {
				logger.debug(COMPONENT, 'Pipeline progress', { step, current, total });
			},
			isAborted: () => this.pipelineAborted,
		};

		const steps = [new TranscribeStep(), new SummarizeStep(), new GenerateNoteStep()];
		const pipeline = new Pipeline();

		new Notice('Processing started...', NOTICE_RETRY_TIMEOUT_MS);

		try {
			const result = await pipeline.execute(steps, context);

			if (this.pipelineAborted) {
				logger.info(COMPONENT, 'Pipeline aborted during unload');
				return;
			}

			if (result.failedStepIndex === undefined && result.context.noteFilePath) {
				this.noticeManager.showSuccess(result.context.noteFilePath);
				await this.applyRetentionPolicy(audioFilePath);
			}
			// Error case: Pipeline already set Error state → StatusBar → onShowError → NoticeManager
		} catch (err) {
			logger.error(COMPONENT, 'Unexpected pipeline error', { error: (err as Error).message });
		}
	}

	private async applyRetentionPolicy(audioFilePath: string): Promise<void> {
		if (this.settings.audioRetentionPolicy === 'delete') {
			const file = this.app.vault.getAbstractFileByPath(audioFilePath);
			if (file instanceof TFile) {
				await this.app.fileManager.trashFile(file);
				logger.info(COMPONENT, 'Audio file trashed per retention policy', { audioFilePath });
			}
		}
	}

	async runTestRecording(onProgress?: (step: string) => void): Promise<TestRecordingResult> {
		const STEP_NAMES = ['transcribing', 'summarizing', 'generating'];

		try {
			await this.recorder.startRecording();
			await new Promise(resolve => setTimeout(resolve, TEST_RECORDING_DURATION_MS));
			const blob = await this.recorder.stopRecording();

			if (!blob) {
				return { success: false, error: 'No audio recorded', failedStep: 'recording' };
			}

			const testAudioPath = `${this.settings.audioFolder}/_test-recording.webm`;
			await this.audioFileManager.saveRecordingToPath(blob, testAudioPath);

			const context: PipelineContext = {
				audioFilePath: testAudioPath,
				vault: this.app.vault,
				settings: this.settings,
				onProgress: (step: string) => {
					onProgress?.(step);
					logger.debug(COMPONENT, 'Test pipeline progress', { step });
				},
				isAborted: () => false,
			};

			const steps = [new TranscribeStep(), new SummarizeStep(), new GenerateNoteStep()];
			const pipeline = new Pipeline();
			const result = await pipeline.execute(steps, context);

			// Clean up test audio file
			const audioFile = this.app.vault.getAbstractFileByPath(testAudioPath);
			if (audioFile instanceof TFile) {
				await this.app.fileManager.trashFile(audioFile);
			}

			if (result.failedStepIndex !== undefined) {
				const failedStep = STEP_NAMES[result.failedStepIndex] ?? 'unknown';
				return { success: false, error: 'Pipeline step failed', failedStep };
			}

			const transcriptPreview = result.context.transcriptionResult?.fullText
				? result.context.transcriptionResult.fullText.substring(0, 100)
				: '';

			return {
				success: true,
				transcriptPreview,
				noteFilePath: result.context.noteFilePath,
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			logger.error(COMPONENT, 'Test recording failed', { error });
			return { success: false, error, failedStep: 'recording' };
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload() {
		this.pipelineAborted = true;
		this.ribbonHandler?.destroy();
		this.statusBar?.destroy();
		this.recorder?.destroy();
		logger.debug(COMPONENT, 'Plugin unloaded');
	}
}
