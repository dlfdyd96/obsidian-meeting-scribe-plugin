import { Notice, Plugin, TFile } from 'obsidian';
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
import { PLUGIN_ID, PLUGIN_NAME, NOTICE_RETRY_TIMEOUT_MS } from './constants';
import { logger } from './utils/logger';
import type { MeetingScribeSettings } from './settings/settings';
import type { PipelineContext } from './pipeline/pipeline-types';

const COMPONENT = 'MeetingScribePlugin';

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;
	private recorder!: Recorder;
	private audioFileManager!: AudioFileManager;
	private statusBar!: StatusBar;
	private ribbonHandler!: RibbonHandler;
	private noticeManager!: NoticeManager;
	private lastPipelineAudioPath: string | null = null;
	private pipelineAborted = false;

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
