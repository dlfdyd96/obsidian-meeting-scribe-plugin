import { Vault, normalizePath } from 'obsidian';
import { logger } from '../utils/logger';

export class AudioFileManager {
	constructor(
		private vault: Vault,
		private getAudioFolder: () => string,
		private getAudioFormat: () => string = () => 'webm',
	) {}

	async saveRecording(blob: Blob): Promise<string> {
		const audioFolder = this.getAudioFolder();
		await this.ensureFolder(audioFolder);

		const filename = this.generateFilename();
		const path = normalizePath(`${audioFolder}/${filename}`);
		const buffer = await blob.arrayBuffer();

		await this.vault.createBinary(path, new Uint8Array(buffer));
		logger.debug('AudioFileManager', 'Recording saved', { path });
		return path;
	}

	async saveRecordingToPath(blob: Blob, path: string): Promise<string> {
		const folder = path.substring(0, path.lastIndexOf('/'));
		if (folder) {
			await this.ensureFolder(folder);
		}
		const buffer = await blob.arrayBuffer();
		await this.vault.createBinary(path, new Uint8Array(buffer));
		logger.debug('AudioFileManager', 'Recording saved to path', { path });
		return path;
	}

	private generateFilename(): string {
		const now = new Date();
		const dateStr = now.toISOString().slice(0, 10);
		const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
		const ext = this.getAudioFormat();
		return `${dateStr}-${timeStr}-recording.${ext}`;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const existing = this.vault.getAbstractFileByPath(folderPath);
		if (!existing) {
			await this.vault.createFolder(folderPath);
		}
	}
}
