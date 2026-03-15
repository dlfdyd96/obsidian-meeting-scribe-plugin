import { Plugin } from 'obsidian';
import { migrateSettings } from './settings/settings-migration';
import { MeetingScribeSettingTab } from './settings/settings-tab';
import { Recorder } from './recording/recorder';
import { AudioFileManager } from './recording/audio-file-manager';
import { StatusBar } from './ui/status-bar';
import { stateManager } from './state/state-manager';
import { logger } from './utils/logger';
import type { MeetingScribeSettings } from './settings/settings';

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;
	private recorder!: Recorder;
	private audioFileManager!: AudioFileManager;
	private statusBar!: StatusBar;

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

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(
			statusBarEl,
			stateManager,
			() => { this.recorder.startRecording(); },
			async () => {
				try {
					const blob = await this.recorder.stopRecording();
					if (blob) {
						await this.audioFileManager.saveRecording(blob);
					}
				} catch (err) {
					logger.error('MeetingScribePlugin', 'Failed to save recording', { error: (err as Error).message });
				}
			},
		);

		logger.debug('MeetingScribePlugin', 'Plugin loaded');
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload() {
		this.statusBar?.destroy();
		this.recorder?.destroy();
		logger.debug('MeetingScribePlugin', 'Plugin unloaded');
	}
}
