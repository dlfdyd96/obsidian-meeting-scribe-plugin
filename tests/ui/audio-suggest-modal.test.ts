// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, Vault } from '../helpers/obsidian-mock';
import { AudioSuggestModal } from '../../src/ui/audio-suggest-modal';
import { logger } from '../../src/utils/logger';

function createTestFiles(): TFile[] {
	return [
		new TFile('recordings/meeting-2026-03-15.webm', 2048000),
		new TFile('recordings/interview.mp3', 5120000),
		new TFile('audio/podcast.m4a', 10240000),
		new TFile('audio/note.wav', 512000),
		new TFile('audio/clip.ogg', 256000),
		new TFile('notes/readme.md', 1024),
		new TFile('images/photo.png', 4096000),
		new TFile('docs/report.pdf', 2048),
	];
}

function createApp(files: TFile[] = []) {
	const vault = new Vault();
	vault.getFiles = vi.fn().mockReturnValue(files);
	return { vault } as Record<string, unknown>;
}

describe('AudioSuggestModal', () => {
	let app: Record<string, unknown>;
	let onSelect: ReturnType<typeof vi.fn>;
	let modal: AudioSuggestModal;

	beforeEach(() => {
		app = createApp(createTestFiles());
		onSelect = vi.fn();
		modal = new AudioSuggestModal(app, onSelect);
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
	});

	describe('getSuggestions', () => {
		it('should return all audio files when query is empty', () => {
			const results = modal.getSuggestions('');
			expect(results).toHaveLength(5);
			expect(results.every(f => ['webm', 'mp3', 'm4a', 'wav', 'ogg'].includes(f.extension))).toBe(true);
		});

		it('should filter by audio extensions only', () => {
			const results = modal.getSuggestions('');
			const extensions = results.map(f => f.extension);
			expect(extensions).not.toContain('md');
			expect(extensions).not.toContain('png');
			expect(extensions).not.toContain('pdf');
		});

		it('should return audio files matching query', () => {
			const results = modal.getSuggestions('meeting');
			expect(results).toHaveLength(1);
			expect(results[0].path).toBe('recordings/meeting-2026-03-15.webm');
		});

		it('should be case-insensitive for query matching', () => {
			const results = modal.getSuggestions('INTERVIEW');
			expect(results).toHaveLength(1);
			expect(results[0].path).toBe('recordings/interview.mp3');
		});

		it('should return empty array when no audio files in vault', () => {
			const emptyApp = createApp([
				new TFile('notes/readme.md', 1024),
				new TFile('images/photo.png', 4096000),
			]);
			const emptyModal = new AudioSuggestModal(emptyApp, onSelect);
			const results = emptyModal.getSuggestions('');
			expect(results).toHaveLength(0);
		});

		it('should exclude non-audio files (md, pdf, png)', () => {
			const results = modal.getSuggestions('');
			const paths = results.map(f => f.path);
			expect(paths).not.toContain('notes/readme.md');
			expect(paths).not.toContain('images/photo.png');
			expect(paths).not.toContain('docs/report.pdf');
		});

		it('should match query against file path', () => {
			const results = modal.getSuggestions('audio/');
			expect(results).toHaveLength(3);
		});

		it('should support all specified audio extensions', () => {
			const allAudioApp = createApp([
				new TFile('a.webm'),
				new TFile('b.mp3'),
				new TFile('c.mp4'),
				new TFile('d.m4a'),
				new TFile('e.wav'),
				new TFile('f.ogg'),
				new TFile('g.mpeg'),
				new TFile('h.mpga'),
			]);
			const allModal = new AudioSuggestModal(allAudioApp, onSelect);
			const results = allModal.getSuggestions('');
			expect(results).toHaveLength(8);
		});
	});

	describe('renderSuggestion', () => {
		it('should display file path', () => {
			const el = document.createElement('div');
			const file = new TFile('recordings/meeting.webm', 2048000);
			modal.renderSuggestion(file, el);

			expect(el.textContent).toContain('recordings/meeting.webm');
		});

		it('should display formatted file size in KB', () => {
			const el = document.createElement('div');
			const file = new TFile('audio/clip.ogg', 512000);
			modal.renderSuggestion(file, el);

			expect(el.textContent).toContain('500.0 KB');
		});

		it('should display formatted file size in MB for large files', () => {
			const el = document.createElement('div');
			const file = new TFile('recordings/meeting.webm', 5242880);
			modal.renderSuggestion(file, el);

			expect(el.textContent).toContain('5.0 MB');
		});
	});

	describe('onChooseSuggestion', () => {
		it('should call onSelect callback with file path', () => {
			const file = new TFile('recordings/meeting.webm');
			modal.onChooseSuggestion(file, new MouseEvent('click'));

			expect(onSelect).toHaveBeenCalledWith('recordings/meeting.webm');
		});

		it('should show Notice with confirmation message', async () => {
			const obsidianMock = await import('../helpers/obsidian-mock');
			const noticeSpy = vi.spyOn(obsidianMock, 'Notice').mockImplementation(() => ({}) as never);

			const file = new TFile('recordings/meeting.webm');
			modal.onChooseSuggestion(file, new MouseEvent('click'));

			expect(noticeSpy).toHaveBeenCalledWith('Audio file selected — ready for processing');
		});
	});

	describe('empty state', () => {
		it('should set emptyStateText in constructor', () => {
			expect(modal.emptyStateText).toBe('No audio files found in vault');
		});
	});
});
