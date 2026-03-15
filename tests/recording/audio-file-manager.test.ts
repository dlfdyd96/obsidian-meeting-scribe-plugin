import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioFileManager } from '../../src/recording/audio-file-manager';
import { logger } from '../../src/utils/logger';

describe('AudioFileManager', () => {
	let audioFileManager: AudioFileManager;
	let mockVault: {
		createBinary: ReturnType<typeof vi.fn>;
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
	};
	const audioFolder = '_attachments/audio';

	beforeEach(() => {
		mockVault = {
			createBinary: vi.fn().mockResolvedValue({ path: '' }),
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			createFolder: vi.fn().mockResolvedValue({}),
		};

		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});

		audioFileManager = new AudioFileManager(
			mockVault as never,
			() => audioFolder,
		);
	});

	describe('saveRecording()', () => {
		it('should save audio to configured audioFolder via vault.createBinary()', async () => {
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await audioFileManager.saveRecording(blob);

			expect(mockVault.createBinary).toHaveBeenCalledTimes(1);
			const callArgs = mockVault.createBinary.mock.calls[0] as [string, ArrayBuffer];
			expect(callArgs[0]).toMatch(new RegExp(`^${audioFolder}/`));
		});

		it('should generate filename in YYYY-MM-DD-HHmmss-recording.webm format', async () => {
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await audioFileManager.saveRecording(blob);

			const callArgs = mockVault.createBinary.mock.calls[0] as [string, ArrayBuffer];
			const filename = callArgs[0].split('/').pop();
			expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-recording\.webm$/);
		});

		it('should create audioFolder if it does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await audioFileManager.saveRecording(blob);

			expect(mockVault.createFolder).toHaveBeenCalledWith(audioFolder);
		});

		it('should return the saved file path', async () => {
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			const path = await audioFileManager.saveRecording(blob);

			expect(path).toMatch(new RegExp(`^${audioFolder}/.*-recording\\.webm$`));
		});

		it('should not create folder if it already exists', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue({ path: audioFolder });
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await audioFileManager.saveRecording(blob);

			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});

		it('should pass ArrayBuffer data to vault.createBinary', async () => {
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await audioFileManager.saveRecording(blob);

			const callArgs = mockVault.createBinary.mock.calls[0] as [string, Uint8Array];
			expect(callArgs[1]).toBeInstanceOf(Uint8Array);
			expect(callArgs[1].byteLength).toBeGreaterThan(0);
		});

		it('should log saved path via Logger', async () => {
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			const path = await audioFileManager.saveRecording(blob);

			expect(logger.debug).toHaveBeenCalledWith('AudioFileManager', 'Recording saved', { path });
		});

		it('should propagate vault.createBinary errors', async () => {
			mockVault.createBinary.mockRejectedValueOnce(new Error('Disk full'));
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await expect(audioFileManager.saveRecording(blob)).rejects.toThrow('Disk full');
		});

		it('should propagate vault.createFolder errors', async () => {
			mockVault.createFolder.mockRejectedValueOnce(new Error('Permission denied'));
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await expect(audioFileManager.saveRecording(blob)).rejects.toThrow('Permission denied');
		});

		it('should use current audioFolder from callback', async () => {
			let folder = 'folder-a';
			const dynamicManager = new AudioFileManager(
				mockVault as never,
				() => folder,
			);
			const blob = new Blob(['test-audio'], { type: 'audio/webm' });

			await dynamicManager.saveRecording(blob);
			const firstPath = (mockVault.createBinary.mock.calls[0] as [string])[0];
			expect(firstPath).toMatch(/^folder-a\//);

			folder = 'folder-b';
			await dynamicManager.saveRecording(blob);
			const secondPath = (mockVault.createBinary.mock.calls[1] as [string])[0];
			expect(secondPath).toMatch(/^folder-b\//);
		});

		it('should handle empty blob', async () => {
			const blob = new Blob([], { type: 'audio/webm' });

			const path = await audioFileManager.saveRecording(blob);

			expect(path).toMatch(/recording\.webm$/);
			expect(mockVault.createBinary).toHaveBeenCalledTimes(1);
		});
	});
});
