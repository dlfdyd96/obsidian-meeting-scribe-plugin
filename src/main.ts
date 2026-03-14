import { Plugin } from 'obsidian';

export default class MeetingScribePlugin extends Plugin {
	async onload() {
		console.debug('Meeting Scribe plugin loaded');
	}

	onunload() {
		console.debug('Meeting Scribe plugin unloaded');
	}
}
