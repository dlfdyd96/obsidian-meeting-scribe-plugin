// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerController } from '../../../src/ui/sidebar/audio-player-controller';
import { Vault } from 'obsidian';

// --- Mock HTMLAudioElement ---
class MockAudioElement {
	src = '';
	currentTime = 0;
	duration = 100;
	paused = true;
	playbackRate = 1;
	volume = 1;
	preload = '';
	private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

	play(): Promise<void> {
		this.paused = false;
		this.emit('play');
		return Promise.resolve();
	}

	pause(): void {
		this.paused = true;
		this.emit('pause');
	}

	addEventListener(event: string, handler: (...args: unknown[]) => void): void {
		if (!this.listeners[event]) this.listeners[event] = [];
		this.listeners[event]!.push(handler);
	}

	removeEventListener(event: string, handler: (...args: unknown[]) => void): void {
		const handlers = this.listeners[event];
		if (handlers) {
			this.listeners[event] = handlers.filter((h) => h !== handler);
		}
	}

	emit(event: string): void {
		const handlers = this.listeners[event];
		if (handlers) {
			for (const h of handlers) h();
		}
	}
}

// --- Mock URL ---
let mockObjectUrl = 'blob:mock-url';
const revokedUrls: string[] = [];

// Store original before tests
const OriginalAudio = globalThis.Audio;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let mockAudio: MockAudioElement;

describe('AudioPlayerController', () => {
	let controller: AudioPlayerController;
	let container: HTMLElement;
	let vault: Vault;

	beforeEach(() => {
		mockAudio = new MockAudioElement();
		revokedUrls.length = 0;
		mockObjectUrl = 'blob:mock-url';

		// Mock Audio constructor
		globalThis.Audio = vi.fn(() => mockAudio) as unknown as typeof Audio;
		URL.createObjectURL = vi.fn(() => mockObjectUrl);
		URL.revokeObjectURL = vi.fn((url: string) => { revokedUrls.push(url); });

		vault = new Vault();
		vault.adapter.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(8));

		container = document.createElement('div');
		controller = new AudioPlayerController();
	});

	afterEach(() => {
		controller.destroy();
		globalThis.Audio = OriginalAudio;
		URL.createObjectURL = originalCreateObjectURL;
		URL.revokeObjectURL = originalRevokeObjectURL;
	});

	describe('load', () => {
		it('should load audio from vault and create ObjectURL', async () => {
			await controller.load('audio/test.webm', vault);

			expect(vault.adapter.readBinary).toHaveBeenCalledWith('audio/test.webm');
			expect(URL.createObjectURL).toHaveBeenCalled();
			expect(mockAudio.src).toBe('blob:mock-url');
		});

		it('should handle missing audio file gracefully', async () => {
			vault.adapter.readBinary = vi.fn().mockRejectedValue(new Error('File not found'));

			await controller.load('audio/missing.webm', vault);

			// Should not throw — audioEl is null, render will show disabled state
			controller.render(container);
			expect(container.querySelector('.meeting-scribe-sidebar-player-disabled')).toBeTruthy();
		});

		it('should set preload to metadata', async () => {
			await controller.load('audio/test.webm', vault);
			expect(mockAudio.preload).toBe('metadata');
		});
	});

	describe('render', () => {
		it('should render player controls when audio is loaded', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			expect(container.querySelector('.meeting-scribe-sidebar-player-controls')).toBeTruthy();
			expect(container.querySelector('.meeting-scribe-sidebar-player-play-btn')).toBeTruthy();
			expect(container.querySelector('.meeting-scribe-sidebar-player-seek-row')).toBeTruthy();
			expect(container.querySelector('.meeting-scribe-sidebar-player-seek-bar')).toBeTruthy();
		});

		it('should render disabled state when audio failed to load', () => {
			controller.render(container);

			expect(container.querySelector('.meeting-scribe-sidebar-player-disabled')).toBeTruthy();
			expect(container.querySelector('.meeting-scribe-sidebar-player-disabled')?.textContent).toBe('Audio not available');
		});

		it('should render volume, skip-back, play, skip-forward, speed buttons in order', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			const controls = container.querySelector('.meeting-scribe-sidebar-player-controls');
			const buttons = controls?.querySelectorAll('button, .meeting-scribe-sidebar-player-speed-wrapper');
			expect(buttons).toBeTruthy();
			expect(buttons!.length).toBeGreaterThanOrEqual(4);
		});

		it('should render seek time labels with current time and duration', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			const times = container.querySelectorAll('.meeting-scribe-sidebar-player-seek-time');
			expect(times.length).toBe(2);
			expect(times[0]?.textContent).toBe('00:00');
			// Duration is 100s in mock, so shows 01:40 when metadata is already loaded
			expect(times[1]?.textContent).toBe('01:40');
		});

		it('should add meeting-scribe-sidebar-player class to container', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
			expect(container.className).toBe('meeting-scribe-sidebar-player');
		});
	});

	describe('play/pause/toggle', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should play audio', () => {
			controller.play();
			expect(mockAudio.paused).toBe(false);
			expect(controller.isPlaying).toBe(true);
		});

		it('should pause audio', () => {
			controller.play();
			controller.pause();
			expect(mockAudio.paused).toBe(true);
			expect(controller.isPlaying).toBe(false);
		});

		it('should toggle play/pause', () => {
			controller.toggle();
			expect(mockAudio.paused).toBe(false);
			controller.toggle();
			expect(mockAudio.paused).toBe(true);
		});

		it('should update play icon to pause when playing', () => {
			controller.play();
			const playBtn = container.querySelector('.meeting-scribe-sidebar-player-play-btn');
			expect(playBtn?.getAttribute('aria-label')).toBe('Pause');
		});

		it('should update pause icon to play when paused', () => {
			controller.play();
			controller.pause();
			const playBtn = container.querySelector('.meeting-scribe-sidebar-player-play-btn');
			expect(playBtn?.getAttribute('aria-label')).toBe('Play');
		});

		it('should do nothing if no audio loaded', () => {
			const emptyController = new AudioPlayerController();
			emptyController.toggle(); // should not throw
			expect(emptyController.isPlaying).toBe(false);
			emptyController.destroy();
		});
	});

	describe('seekTo', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should seek to specified time', () => {
			controller.seekTo(30);
			expect(mockAudio.currentTime).toBe(30);
		});

		it('should clamp to 0 for negative values', () => {
			controller.seekTo(-10);
			expect(mockAudio.currentTime).toBe(0);
		});

		it('should clamp to duration for values exceeding duration', () => {
			controller.seekTo(200);
			expect(mockAudio.currentTime).toBe(100);
		});

		it('should update seek bar after seeking', () => {
			controller.seekTo(50);
			const fill = container.querySelector('.meeting-scribe-sidebar-player-seek-fill') as HTMLElement;
			expect(fill?.style.width).toBe('50%');
		});
	});

	describe('skip', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should skip forward by delta', () => {
			mockAudio.currentTime = 10;
			controller.skip(5);
			expect(mockAudio.currentTime).toBe(15);
		});

		it('should skip backward by delta', () => {
			mockAudio.currentTime = 10;
			controller.skip(-5);
			expect(mockAudio.currentTime).toBe(5);
		});

		it('should not go below 0 when skipping back', () => {
			mockAudio.currentTime = 2;
			controller.skip(-5);
			expect(mockAudio.currentTime).toBe(0);
		});
	});

	describe('setSpeed', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should set playback rate', () => {
			controller.setSpeed(1.5);
			expect(mockAudio.playbackRate).toBe(1.5);
		});

		it('should update speed button text', () => {
			controller.setSpeed(2);
			const speedBtn = container.querySelector('.meeting-scribe-sidebar-player-speed-btn');
			expect(speedBtn?.textContent).toBe('2x');
		});

		it('should highlight selected speed in popup', () => {
			controller.setSpeed(1.5);
			const selected = container.querySelector('.meeting-scribe-sidebar-player-speed-option--selected');
			expect(selected?.textContent).toBe('1.5x');
		});
	});

	describe('setVolume', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should set volume level', () => {
			controller.setVolume(0.5);
			expect(mockAudio.volume).toBe(0.5);
		});

		it('should clamp volume to 0-1 range', () => {
			controller.setVolume(-0.5);
			expect(mockAudio.volume).toBe(0);
			controller.setVolume(1.5);
			expect(mockAudio.volume).toBe(1);
		});

		it('should show mute icon when volume is 0', () => {
			controller.setVolume(0);
			const volumeBtn = container.querySelector('.meeting-scribe-sidebar-player-volume-btn');
			expect(volumeBtn?.getAttribute('aria-label')).toBe('Unmute');
		});

		it('should show volume icon when volume > 0', () => {
			controller.setVolume(0);
			controller.setVolume(0.5);
			const volumeBtn = container.querySelector('.meeting-scribe-sidebar-player-volume-btn');
			expect(volumeBtn?.getAttribute('aria-label')).toBe('Volume');
		});
	});

	describe('volume slider popup', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should show volume popup when clicking volume button', () => {
			const volumeBtn = container.querySelector('.meeting-scribe-sidebar-player-volume-btn') as HTMLElement;
			volumeBtn.click();
			const popup = container.querySelector('.meeting-scribe-sidebar-player-volume-popup');
			expect(popup?.classList.contains('meeting-scribe-sidebar-player-volume-popup--visible')).toBe(true);
		});

		it('should hide volume popup when clicking volume button again', () => {
			const volumeBtn = container.querySelector('.meeting-scribe-sidebar-player-volume-btn') as HTMLElement;
			volumeBtn.click(); // show
			volumeBtn.click(); // hide
			const popup = container.querySelector('.meeting-scribe-sidebar-player-volume-popup');
			expect(popup?.classList.contains('meeting-scribe-sidebar-player-volume-popup--visible')).toBe(false);
		});

		it('should contain a custom volume track with fill and thumb', () => {
			const track = container.querySelector('.meeting-scribe-sidebar-volume-track');
			const fill = container.querySelector('.meeting-scribe-sidebar-volume-fill');
			const thumb = container.querySelector('.meeting-scribe-sidebar-volume-thumb');
			expect(track).not.toBeNull();
			expect(fill).not.toBeNull();
			expect(thumb).not.toBeNull();
		});

		it('should update volume fill when setVolume is called', () => {
			controller.setVolume(0.3);
			const fill = container.querySelector('.meeting-scribe-sidebar-volume-fill') as HTMLElement;
			expect(fill.style.height).toBe('30%');
		});

		it('should update volume thumb position when setVolume is called', () => {
			controller.setVolume(0.7);
			const thumb = container.querySelector('.meeting-scribe-sidebar-volume-thumb') as HTMLElement;
			expect(thumb.style.bottom).toBe('70%');
		});
	});

	describe('speed popup', () => {
		beforeEach(async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
		});

		it('should toggle speed popup visibility', () => {
			const speedBtn = container.querySelector('.meeting-scribe-sidebar-player-speed-btn') as HTMLElement;
			speedBtn.click();
			const popup = container.querySelector('.meeting-scribe-sidebar-player-speed-popup');
			expect(popup?.classList.contains('meeting-scribe-sidebar-player-speed-popup--visible')).toBe(true);
		});

		it('should close speed popup when clicking outside', () => {
			const speedBtn = container.querySelector('.meeting-scribe-sidebar-player-speed-btn') as HTMLElement;
			speedBtn.click();
			// Simulate document click outside
			document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			const popup = container.querySelector('.meeting-scribe-sidebar-player-speed-popup');
			expect(popup?.classList.contains('meeting-scribe-sidebar-player-speed-popup--visible')).toBe(false);
		});

		it('should have 4 speed options', () => {
			const options = container.querySelectorAll('.meeting-scribe-sidebar-player-speed-option');
			expect(options.length).toBe(4);
		});

		it('should apply speed and close popup when option clicked', () => {
			const speedBtn = container.querySelector('.meeting-scribe-sidebar-player-speed-btn') as HTMLElement;
			speedBtn.click();
			const options = container.querySelectorAll('.meeting-scribe-sidebar-player-speed-option');
			// Click 1.5x (index 2)
			(options[2] as HTMLElement).click();
			expect(mockAudio.playbackRate).toBe(1.5);
			const popup = container.querySelector('.meeting-scribe-sidebar-player-speed-popup');
			expect(popup?.classList.contains('meeting-scribe-sidebar-player-speed-popup--visible')).toBe(false);
		});
	});

	describe('seek bar interaction', () => {
		it('should seek on seek bar mousedown', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			const seekBar = container.querySelector('.meeting-scribe-sidebar-player-seek-bar') as HTMLElement;
			// Simulate getBoundingClientRect
			seekBar.getBoundingClientRect = () => ({
				left: 0, right: 200, width: 200,
				top: 0, bottom: 10, height: 10, x: 0, y: 0,
				toJSON() { return {}; },
			});

			const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, bubbles: true });
			seekBar.dispatchEvent(mousedownEvent);

			// 100/200 = 0.5 * 100 duration = 50
			expect(mockAudio.currentTime).toBe(50);
		});

		it('should seek on drag (mousemove after mousedown)', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			const seekBar = container.querySelector('.meeting-scribe-sidebar-player-seek-bar') as HTMLElement;
			seekBar.getBoundingClientRect = () => ({
				left: 0, right: 200, width: 200,
				top: 0, bottom: 10, height: 10, x: 0, y: 0,
				toJSON() { return {}; },
			});

			// mousedown at 50%
			seekBar.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
			expect(mockAudio.currentTime).toBe(50);

			// drag to 75%
			document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true }));
			expect(mockAudio.currentTime).toBe(75);

			// release
			document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

			// mousemove after release should not seek
			document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, bubbles: true }));
			expect(mockAudio.currentTime).toBe(75);
		});
	});

	describe('timeupdate callback', () => {
		it('should call onTimeUpdate callback when audio time updates', async () => {
			const onTimeUpdate = vi.fn();
			const callbackController = new AudioPlayerController(onTimeUpdate);
			await callbackController.load('audio/test.webm', vault);
			callbackController.render(container);

			mockAudio.currentTime = 42;
			mockAudio.emit('timeupdate');

			expect(onTimeUpdate).toHaveBeenCalledWith(42);
			callbackController.destroy();
		});

		it('should update current time display on timeupdate', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			mockAudio.currentTime = 65; // 1:05
			mockAudio.emit('timeupdate');

			const currentTimeEl = container.querySelectorAll('.meeting-scribe-sidebar-player-seek-time')[0];
			expect(currentTimeEl?.textContent).toBe('01:05');
		});
	});

	describe('loadedmetadata', () => {
		it('should update duration display when metadata loaded', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			mockAudio.duration = 300; // 5:00
			mockAudio.emit('loadedmetadata');

			const durationEl = container.querySelectorAll('.meeting-scribe-sidebar-player-seek-time')[1];
			expect(durationEl?.textContent).toBe('05:00');
		});
	});

	describe('ended', () => {
		it('should show play icon when audio ends', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);

			controller.play();
			mockAudio.paused = true; // ended state
			mockAudio.emit('ended');

			const playBtn = container.querySelector('.meeting-scribe-sidebar-player-play-btn');
			expect(playBtn?.getAttribute('aria-label')).toBe('Play');
		});
	});

	describe('destroy', () => {
		it('should revoke ObjectURL on destroy', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
			controller.destroy();

			expect(revokedUrls).toContain('blob:mock-url');
		});

		it('should pause audio on destroy', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
			controller.play();
			controller.destroy();

			expect(mockAudio.paused).toBe(true);
		});

		it('should clear container DOM on destroy', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
			expect(container.children.length).toBeGreaterThan(0);
			controller.destroy();
			expect(container.children.length).toBe(0);
		});

		it('should be safe to call destroy multiple times', async () => {
			await controller.load('audio/test.webm', vault);
			controller.render(container);
			controller.destroy();
			controller.destroy(); // should not throw
		});

		it('should not load after destroy', async () => {
			controller.destroy();
			await controller.load('audio/test.webm', vault);
			expect(controller.isPlaying).toBe(false);
			expect(controller.duration).toBe(0);
		});
	});

	describe('getters', () => {
		it('should return 0 for currentTime when no audio', () => {
			expect(controller.currentTime).toBe(0);
		});

		it('should return 0 for duration when no audio', () => {
			expect(controller.duration).toBe(0);
		});

		it('should return false for isPlaying when no audio', () => {
			expect(controller.isPlaying).toBe(false);
		});

		it('should return current time from audio element', async () => {
			await controller.load('audio/test.webm', vault);
			mockAudio.currentTime = 42;
			expect(controller.currentTime).toBe(42);
		});

		it('should return duration from audio element', async () => {
			await controller.load('audio/test.webm', vault);
			expect(controller.duration).toBe(100);
		});

		it('should return 0 for Infinity duration', async () => {
			await controller.load('audio/test.webm', vault);
			mockAudio.duration = Infinity;
			expect(controller.duration).toBe(0);
		});
	});
});
