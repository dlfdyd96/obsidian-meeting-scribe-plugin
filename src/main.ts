import { Plugin } from 'obsidian';
import { migrateSettings } from './settings/settings-migration';
import { MeetingScribeSettingTab } from './settings/settings-tab';
import { Recorder } from './recording/recorder';
import { AudioFileManager } from './recording/audio-file-manager';
import { StatusBar } from './ui/status-bar';
import { RibbonHandler } from './ui/ribbon-handler';
import { AudioSuggestModal } from './ui/audio-suggest-modal';
import { stateManager } from './state/state-manager';
import { PluginState } from './state/types';
import { PLUGIN_NAME } from './constants';
import { logger } from './utils/logger';
import type { MeetingScribeSettings } from './settings/settings';

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;
	lastImportedAudioPath: string | null = null;
	private recorder!: Recorder;
	private audioFileManager!: AudioFileManager;
	private statusBar!: StatusBar;
	private ribbonHandler!: RibbonHandler;

	async onload() {
		const data: unknown = await this.loadData();
		this.settings = migrateSettings(data);
		logger.setDebugMode(this.settings.debugMode);
		this.addSettingTab(new MeetingScribeSettingTab(this.app, this));

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
						await this.audioFileManager.saveRecording(blob);
					}
				} catch (err) {
					logger.error('MeetingScribePlugin', 'Failed to save recording', { error: (err as Error).message });
				}
			})();
		};

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(
			statusBarEl,
			stateManager,
			startRecordingFlow,
			stopRecordingFlow,
			(path: string) => {
				void this.app.workspace.openLinkText(path, '', false);
			},
			(error: Error) => {
				// Delegates to Notice system (Story 5.4) — basic fallback for now
				logger.error('MeetingScribePlugin', 'Pipeline error', { error: error.message });
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
				if (stateManager.getState() === PluginState.Idle) {
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
				if (state === PluginState.Idle) {
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
				if (stateManager.getState() === PluginState.Idle) {
					const modal = new AudioSuggestModal(this.app, (filePath: string) => {
						this.lastImportedAudioPath = filePath;
					});
					modal.open();
				}
			},
		});

		logger.debug('MeetingScribePlugin', 'Plugin loaded');
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload() {
		this.ribbonHandler?.destroy();
		this.statusBar?.destroy();
		this.recorder?.destroy();
		logger.debug('MeetingScribePlugin', 'Plugin unloaded');
	}
}
