import type { Vault } from 'obsidian';
import { logger } from '../../utils/logger';
import { createSvgIcon } from './svg-icons';

const COMPONENT = 'AudioPlayerController';

const SPEED_OPTIONS = [1, 1.25, 1.5, 2];

/**
 * Wraps HTML5 <audio> element for meeting playback in the Sidebar.
 * Renders controls (play/pause, skip, speed, volume, seek bar) and
 * exposes an onTimeUpdate callback for Story 13.2 synchronization.
 */
export class AudioPlayerController {
	private audioEl: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;
	private container: HTMLElement | null = null;
	private seekFillEl: HTMLElement | null = null;
	private seekBarEl: HTMLElement | null = null;
	private isDragging = false;
	private currentTimeEl: HTMLElement | null = null;
	private durationEl: HTMLElement | null = null;
	private playBtnIcon: HTMLElement | null = null;
	private speedBtnEl: HTMLElement | null = null;
	private speedPopupEl: HTMLElement | null = null;
	private volumeBtnIcon: HTMLElement | null = null;
	private volumePopupEl: HTMLElement | null = null;
	private volumeSliderEl: HTMLInputElement | null = null;
	private volumeTrackEl: HTMLElement | null = null;
	private volumeFillEl: HTMLElement | null = null;
	private volumeThumbEl: HTMLElement | null = null;
	private volumeDragging = false;
	private previousVolume = 1;
	private destroyed = false;

	private boundTimeUpdate: (() => void) | null = null;
	private boundLoadedMetadata: (() => void) | null = null;
	private boundEnded: (() => void) | null = null;
	private boundPlay: (() => void) | null = null;
	private boundPause: (() => void) | null = null;
	private boundDurationChange: (() => void) | null = null;
	private boundDocumentClick: ((e: MouseEvent) => void) | null = null;

	constructor(private readonly onTimeUpdate?: (currentTime: number) => void) {}

	/**
	 * Load audio from vault binary path into an HTMLAudioElement.
	 * Creates a Blob ObjectURL for playback.
	 */
	async load(audioFilePath: string, vault: Vault): Promise<void> {
		if (this.destroyed) return;

		try {
			const arrayBuffer = await vault.adapter.readBinary(audioFilePath);
			// Include MIME type hint so the browser can parse duration for webm/ogg
			const mimeType = this.guessMimeType(audioFilePath);
			const blob = new Blob([arrayBuffer], mimeType ? { type: mimeType } : undefined);
			this.objectUrl = URL.createObjectURL(blob);

			this.audioEl = new Audio();
			this.audioEl.src = this.objectUrl;
			this.audioEl.preload = 'metadata';

			this.boundTimeUpdate = () => this.handleTimeUpdate();
			this.boundLoadedMetadata = () => this.handleLoadedMetadata();
			this.boundEnded = () => this.handleEnded();
			this.boundPlay = () => this.updatePlayIcon();
			this.boundPause = () => this.updatePlayIcon();
			this.boundDurationChange = () => this.handleLoadedMetadata();

			this.audioEl.addEventListener('timeupdate', this.boundTimeUpdate);
			this.audioEl.addEventListener('loadedmetadata', this.boundLoadedMetadata);
			this.audioEl.addEventListener('durationchange', this.boundDurationChange);
			this.audioEl.addEventListener('ended', this.boundEnded);
			this.audioEl.addEventListener('play', this.boundPlay);
			this.audioEl.addEventListener('pause', this.boundPause);

			logger.debug(COMPONENT, 'Audio loaded', { audioFilePath });
		} catch (err) {
			logger.warn(COMPONENT, 'Failed to load audio file', {
				audioFilePath,
				error: err instanceof Error ? err.message : String(err),
			});
			this.audioEl = null;
		}
	}

	/**
	 * Build player DOM into the given container element.
	 */
	render(container: HTMLElement): void {
		this.container = container;
		container.className = 'meeting-scribe-sidebar-player';

		if (!this.audioEl) {
			this.renderDisabledState(container);
			return;
		}

		// Controls row: volume | skip-back | play/pause | skip-forward | speed
		const controls = document.createElement('div');
		controls.className = 'meeting-scribe-sidebar-player-controls';

		controls.appendChild(this.createVolumeControl());
		controls.appendChild(this.createSkipButton(-5, 'Skip back 5s'));
		controls.appendChild(this.createPlayButton());
		controls.appendChild(this.createSkipButton(5, 'Skip forward 5s'));
		controls.appendChild(this.createSpeedControl());

		container.appendChild(controls);

		// Seek row: current time | seek bar | duration
		const seekRow = document.createElement('div');
		seekRow.className = 'meeting-scribe-sidebar-player-seek-row';

		this.currentTimeEl = document.createElement('span');
		this.currentTimeEl.className = 'meeting-scribe-sidebar-player-seek-time';
		this.currentTimeEl.textContent = '00:00';
		seekRow.appendChild(this.currentTimeEl);

		const seekBar = document.createElement('div');
		seekBar.className = 'meeting-scribe-sidebar-player-seek-bar';
		this.seekBarEl = seekBar;
		seekBar.addEventListener('mousedown', (e) => this.handleSeekDragStart(e));

		this.seekFillEl = document.createElement('div');
		this.seekFillEl.className = 'meeting-scribe-sidebar-player-seek-fill';
		seekBar.appendChild(this.seekFillEl);

		seekRow.appendChild(seekBar);

		this.durationEl = document.createElement('span');
		this.durationEl.className = 'meeting-scribe-sidebar-player-seek-time';
		this.durationEl.textContent = '00:00';
		seekRow.appendChild(this.durationEl);

		container.appendChild(seekRow);

		// If metadata already loaded (e.g. render called after load completed), set duration now
		if (this.duration > 0 && this.durationEl) {
			this.durationEl.textContent = this.formatTime(this.duration);
		}

		// Register document click listener for closing speed popup
		this.boundDocumentClick = (e: MouseEvent) => this.handleDocumentClick(e);
		document.addEventListener('click', this.boundDocumentClick);
	}

	play(): void {
		if (!this.audioEl) return;
		this.audioEl.play().catch((err) => {
			logger.warn(COMPONENT, 'Playback failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}

	pause(): void {
		if (!this.audioEl) return;
		this.audioEl.pause();
	}

	toggle(): void {
		if (!this.audioEl) return;
		if (this.audioEl.paused) {
			this.play();
		} else {
			this.pause();
		}
	}

	seekTo(seconds: number): void {
		if (!this.audioEl) return;
		const clamped = Math.max(0, Math.min(seconds, this.duration));
		this.audioEl.currentTime = clamped;
		this.updateSeekBar();
	}

	skip(deltaSeconds: number): void {
		if (!this.audioEl) return;
		this.seekTo(this.audioEl.currentTime + deltaSeconds);
	}

	setSpeed(rate: number): void {
		if (!this.audioEl) return;
		this.audioEl.playbackRate = rate;
		if (this.speedBtnEl) {
			this.speedBtnEl.textContent = rate === 1 ? '1x' : `${rate}x`;
		}
		this.updateSpeedPopupSelection(rate);
	}

	setVolume(level: number): void {
		if (!this.audioEl) return;
		const clamped = Math.max(0, Math.min(1, level));
		this.audioEl.volume = clamped;
		this.updateVolumeIcon();
		// Update custom slider visuals
		const pct = `${Math.round(clamped * 100)}%`;
		if (this.volumeFillEl) this.volumeFillEl.setCssStyles({ height: pct });
		if (this.volumeThumbEl) this.volumeThumbEl.setCssStyles({ bottom: pct });
	}

	/**
	 * Clean up: revoke ObjectURL, remove listeners, clear DOM.
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		if (this.audioEl) {
			this.audioEl.pause();
			if (this.boundTimeUpdate) {
				this.audioEl.removeEventListener('timeupdate', this.boundTimeUpdate);
			}
			if (this.boundLoadedMetadata) {
				this.audioEl.removeEventListener('loadedmetadata', this.boundLoadedMetadata);
			}
			if (this.boundEnded) {
				this.audioEl.removeEventListener('ended', this.boundEnded);
			}
			if (this.boundDurationChange) {
				this.audioEl.removeEventListener('durationchange', this.boundDurationChange);
			}
			if (this.boundPlay) {
				this.audioEl.removeEventListener('play', this.boundPlay);
			}
			if (this.boundPause) {
				this.audioEl.removeEventListener('pause', this.boundPause);
			}
			this.audioEl = null;
		}

		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}

		if (this.boundDocumentClick) {
			document.removeEventListener('click', this.boundDocumentClick);
			this.boundDocumentClick = null;
		}

		if (this.container) {
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}
		}

		logger.debug(COMPONENT, 'Audio player destroyed');
	}

	get currentTime(): number {
		return this.audioEl?.currentTime ?? 0;
	}

	get duration(): number {
		const d = this.audioEl?.duration ?? 0;
		return isFinite(d) ? d : 0;
	}

	get isPlaying(): boolean {
		return this.audioEl ? !this.audioEl.paused : false;
	}

	// --- Private rendering helpers ---

	private renderDisabledState(container: HTMLElement): void {
		const msg = document.createElement('div');
		msg.className = 'meeting-scribe-sidebar-player-disabled';
		msg.textContent = 'Audio not available';
		container.appendChild(msg);
	}

	private createPlayButton(): HTMLElement {
		const btn = document.createElement('button');
		btn.className = 'meeting-scribe-sidebar-player-play-btn';
		btn.setAttribute('aria-label', 'Play');
		this.playBtnIcon = document.createElement('span');
		createSvgIcon(this.playBtnIcon, this.playSvg());
		btn.appendChild(this.playBtnIcon);
		btn.addEventListener('click', () => this.toggle());
		return btn;
	}

	private createSkipButton(delta: number, label: string): HTMLElement {
		const btn = document.createElement('button');
		btn.className = 'meeting-scribe-sidebar-player-skip-btn';
		btn.setAttribute('aria-label', label);
		if (delta < 0) {
			createSvgIcon(btn, '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>');
		} else {
			createSvgIcon(btn, '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="transform:scaleX(-1)"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>');
		}
		btn.addEventListener('click', () => this.skip(delta));
		return btn;
	}

	private createVolumeControl(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'meeting-scribe-sidebar-player-volume-wrapper';

		const btn = document.createElement('button');
		btn.className = 'meeting-scribe-sidebar-player-volume-btn';
		btn.setAttribute('aria-label', 'Volume');
		this.volumeBtnIcon = document.createElement('span');
		createSvgIcon(this.volumeBtnIcon, this.volumeOnSvg());
		btn.appendChild(this.volumeBtnIcon);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleVolumePopup();
		});
		wrapper.appendChild(btn);

		this.volumePopupEl = document.createElement('div');
		this.volumePopupEl.className = 'meeting-scribe-sidebar-player-volume-popup';

		// Custom vertical volume slider (track + fill + thumb)
		this.volumeTrackEl = document.createElement('div');
		this.volumeTrackEl.className = 'meeting-scribe-sidebar-volume-track';

		this.volumeFillEl = document.createElement('div');
		this.volumeFillEl.className = 'meeting-scribe-sidebar-volume-fill';
		this.volumeFillEl.setCssStyles({ height: '100%' });

		this.volumeThumbEl = document.createElement('div');
		this.volumeThumbEl.className = 'meeting-scribe-sidebar-volume-thumb';
		this.volumeThumbEl.setCssStyles({ bottom: '100%' });

		this.volumeTrackEl.appendChild(this.volumeFillEl);
		this.volumeTrackEl.appendChild(this.volumeThumbEl);

		const setVolumeFromY = (e: MouseEvent): void => {
			if (!this.volumeTrackEl) return;
			const rect = this.volumeTrackEl.getBoundingClientRect();
			const y = Math.max(0, Math.min(rect.height, rect.bottom - e.clientY));
			const level = y / rect.height;
			this.setVolume(level);
		};

		this.volumeTrackEl.addEventListener('mousedown', (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.volumeDragging = true;
			setVolumeFromY(e);

			const onMove = (ev: MouseEvent): void => {
				if (this.volumeDragging) setVolumeFromY(ev);
			};
			const onUp = (): void => {
				this.volumeDragging = false;
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});

		this.volumePopupEl.appendChild(this.volumeTrackEl);
		wrapper.appendChild(this.volumePopupEl);

		return wrapper;
	}

	private createSpeedControl(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'meeting-scribe-sidebar-player-speed-wrapper';

		this.speedBtnEl = document.createElement('button');
		this.speedBtnEl.className = 'meeting-scribe-sidebar-player-speed-btn';
		this.speedBtnEl.textContent = '1x';
		this.speedBtnEl.setAttribute('aria-label', 'Playback speed');
		this.speedBtnEl.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleSpeedPopup();
		});
		wrapper.appendChild(this.speedBtnEl);

		this.speedPopupEl = document.createElement('div');
		this.speedPopupEl.className = 'meeting-scribe-sidebar-player-speed-popup';
		for (const rate of SPEED_OPTIONS) {
			const opt = document.createElement('button');
			opt.className = 'meeting-scribe-sidebar-player-speed-option';
			opt.textContent = rate === 1 ? '1x' : `${rate}x`;
			if (rate === 1) opt.classList.add('meeting-scribe-sidebar-player-speed-option--selected');
			opt.addEventListener('click', (e) => {
				e.stopPropagation();
				this.setSpeed(rate);
				this.closeSpeedPopup();
			});
			this.speedPopupEl.appendChild(opt);
		}
		wrapper.appendChild(this.speedPopupEl);

		return wrapper;
	}

	private toggleVolumePopup(): void {
		if (!this.volumePopupEl) return;
		const isVisible = this.volumePopupEl.classList.contains('meeting-scribe-sidebar-player-volume-popup--visible');
		if (isVisible) {
			this.closeVolumePopup();
		} else {
			this.volumePopupEl.classList.add('meeting-scribe-sidebar-player-volume-popup--visible');
		}
	}

	private closeVolumePopup(): void {
		this.volumePopupEl?.classList.remove('meeting-scribe-sidebar-player-volume-popup--visible');
	}

	private toggleSpeedPopup(): void {
		if (!this.speedPopupEl) return;
		const isVisible = this.speedPopupEl.classList.contains('meeting-scribe-sidebar-player-speed-popup--visible');
		if (isVisible) {
			this.closeSpeedPopup();
		} else {
			this.speedPopupEl.classList.add('meeting-scribe-sidebar-player-speed-popup--visible');
		}
	}

	private closeSpeedPopup(): void {
		this.speedPopupEl?.classList.remove('meeting-scribe-sidebar-player-speed-popup--visible');
	}

	private updateSpeedPopupSelection(rate: number): void {
		if (!this.speedPopupEl) return;
		const options = this.speedPopupEl.querySelectorAll('.meeting-scribe-sidebar-player-speed-option');
		options.forEach((opt) => {
			const optRate = parseFloat(opt.textContent ?? '1');
			if (optRate === rate) {
				opt.classList.add('meeting-scribe-sidebar-player-speed-option--selected');
			} else {
				opt.classList.remove('meeting-scribe-sidebar-player-speed-option--selected');
			}
		});
	}

	private handleDocumentClick(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (this.speedPopupEl && this.speedBtnEl &&
			!this.speedBtnEl.contains(target) && !this.speedPopupEl.contains(target)) {
			this.closeSpeedPopup();
		}
		if (this.volumePopupEl &&
			!this.volumePopupEl.contains(target) &&
			!this.volumePopupEl.previousElementSibling?.contains(target)) {
			this.closeVolumePopup();
		}
	}

	private handleSeekDragStart(e: MouseEvent): void {
		if (!this.seekBarEl) return;
		e.preventDefault();
		this.isDragging = true;

		this.seekFromMouseEvent(e);

		const onMove = (moveEvent: MouseEvent) => {
			if (!this.isDragging) return;
			this.seekFromMouseEvent(moveEvent);
		};

		const onUp = () => {
			this.isDragging = false;
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	private seekFromMouseEvent(e: MouseEvent): void {
		if (!this.seekBarEl) return;
		const rect = this.seekBarEl.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		this.seekTo(ratio * this.duration);
	}

	private handleTimeUpdate(): void {
		this.updateSeekBar();
		if (this.onTimeUpdate) {
			this.onTimeUpdate(this.currentTime);
		}
	}

	private handleLoadedMetadata(): void {
		if (this.durationEl) {
			this.durationEl.textContent = this.formatTime(this.duration);
		}
	}

	private handleEnded(): void {
		this.updatePlayIcon();
	}

	updateSeekBar(): void {
		if (!this.seekFillEl || !this.currentTimeEl) return;
		const d = this.duration;
		const progress = d > 0 ? (this.currentTime / d) * 100 : 0;
		// Disable transition during drag for instant feedback
		if (this.isDragging) {
			this.seekFillEl.setCssStyles({ transition: 'none' });
		} else {
			this.seekFillEl.setCssStyles({ transition: '' });
		}
		this.seekFillEl.setCssStyles({ width: `${progress}%` });
		this.currentTimeEl.textContent = this.formatTime(this.currentTime);
	}

	private updatePlayIcon(): void {
		if (!this.playBtnIcon) return;
		this.playBtnIcon.empty();
		if (this.isPlaying) {
			createSvgIcon(this.playBtnIcon, this.pauseSvg());
			this.playBtnIcon.closest('button')?.setAttribute('aria-label', 'Pause');
		} else {
			createSvgIcon(this.playBtnIcon, this.playSvg());
			this.playBtnIcon.closest('button')?.setAttribute('aria-label', 'Play');
		}
	}

	private updateVolumeIcon(): void {
		if (!this.volumeBtnIcon || !this.audioEl) return;
		this.volumeBtnIcon.empty();
		if (this.audioEl.volume === 0) {
			createSvgIcon(this.volumeBtnIcon, this.volumeOffSvg());
			this.volumeBtnIcon.closest('button')?.setAttribute('aria-label', 'Unmute');
		} else {
			createSvgIcon(this.volumeBtnIcon, this.volumeOnSvg());
			this.volumeBtnIcon.closest('button')?.setAttribute('aria-label', 'Volume');
		}
	}

	private formatTime(seconds: number): string {
		const total = Math.floor(seconds);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	private guessMimeType(filePath: string): string | undefined {
		const ext = filePath.split('.').pop()?.toLowerCase();
		const map: Record<string, string> = {
			webm: 'audio/webm',
			ogg: 'audio/ogg',
			mp3: 'audio/mpeg',
			wav: 'audio/wav',
			m4a: 'audio/mp4',
			mp4: 'audio/mp4',
			flac: 'audio/flac',
		};
		return ext ? map[ext] : undefined;
	}

	// SVG icon strings
	private playSvg(): string {
		return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
	}

	private pauseSvg(): string {
		return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
	}

	private volumeOnSvg(): string {
		return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
	}

	private volumeOffSvg(): string {
		return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
	}
}
