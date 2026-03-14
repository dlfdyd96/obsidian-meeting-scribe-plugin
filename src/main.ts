import { Plugin } from 'obsidian';
import { migrateSettings } from './settings/settings-migration';
import { MeetingScribeSettingTab } from './settings/settings-tab';
import { logger } from './utils/logger';
import type { MeetingScribeSettings } from './settings/settings';

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;

	async onload() {
		const data: unknown = await this.loadData();
		this.settings = migrateSettings(data);
		logger.setDebugMode(this.settings.debugMode);
		this.addSettingTab(new MeetingScribeSettingTab(this.app, this));
		console.debug('Meeting Scribe plugin loaded');
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload() {
		console.debug('Meeting Scribe plugin unloaded');
	}
}
