// Mock for the 'obsidian' module which is provided at runtime by the Obsidian app.
// This file is aliased in vitest.config.ts so that imports of 'obsidian' resolve here during tests.

export class Plugin {
	app: unknown = {};
	manifest: unknown = {};
	async loadData(): Promise<unknown> { return null; }
	async saveData(_data: unknown): Promise<void> { /* noop */ }
	addRibbonIcon() { return document.createElement('div'); }
	addStatusBarItem() { return document.createElement('div'); }
	addCommand() { return null; }
	addSettingTab() { /* noop */ }
	registerDomEvent() { /* noop */ }
	registerInterval() { return 0; }
}

export class Notice {
	constructor(_message: string) { /* noop */ }
}
