import { StateManager } from '../state/state-manager';
import { PluginState } from '../state/types';
import { PLUGIN_NAME } from '../constants';
import { logger } from '../utils/logger';

export class StatusBar {
	private intervalId: number | null = null;
	private recordingStartTime: number = 0;
	private readonly observer: (newState: PluginState) => void;
	private readonly handleClick: () => void;

	constructor(
		private readonly el: HTMLElement,
		private readonly stateManager: StateManager,
		private readonly onStartRecording: () => void,
		private readonly onStopRecording: () => void,
		private readonly warningThresholdSeconds: number = 0,
	) {
		this.el.setAttribute('aria-live', 'polite');

		this.observer = (newState: PluginState) => this.onStateChange(newState);
		this.stateManager.subscribe(this.observer);

		this.handleClick = () => {
			const state = this.stateManager.getState();
			if (state === PluginState.Idle) {
				this.onStartRecording();
			} else if (state === PluginState.Recording) {
				this.onStopRecording();
			}
		};
		this.el.addEventListener('click', this.handleClick);

		this.renderIdle();
		logger.debug('StatusBar', 'Initialized');
	}

	private onStateChange(newState: PluginState): void {
		if (newState === PluginState.Recording) {
			this.startTimer();
			this.renderRecording(0);
		} else {
			this.stopTimer();
			this.renderIdle();
		}
		logger.debug('StatusBar', 'State changed', { newState });
	}

	private renderIdle(): void {
		this.el.textContent = `🎙 ${PLUGIN_NAME}`;
		this.el.style.color = 'var(--text-muted)';
	}

	private renderRecording(elapsedSeconds: number): void {
		const timeStr = this.formatElapsedTime(elapsedSeconds);
		this.el.textContent = `🔴 Recording ${timeStr}`;

		if (this.warningThresholdSeconds > 0 && elapsedSeconds >= this.warningThresholdSeconds) {
			this.el.style.color = 'var(--text-warning)';
		} else {
			this.el.style.color = 'var(--text-error)';
		}
	}

	private formatElapsedTime(totalSeconds: number): string {
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	private startTimer(): void {
		this.recordingStartTime = Date.now();
		this.intervalId = window.setInterval(() => {
			const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
			this.renderRecording(elapsed);
		}, 1000);
	}

	private stopTimer(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	destroy(): void {
		this.stopTimer();
		this.stateManager.unsubscribe(this.observer);
		this.el.removeEventListener('click', this.handleClick);
		logger.debug('StatusBar', 'Destroyed');
	}
}
