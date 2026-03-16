import { StateManager } from '../state/state-manager';
import { PluginState, StateContext, StateObserver } from '../state/types';
import { PLUGIN_NAME } from '../constants';
import { logger } from '../utils/logger';

const STEP_DISPLAY_NAMES: Record<string, string> = {
	transcribing: 'Transcribing',
	summarizing: 'Summarizing',
	generating: 'Creating note',
};

const COMPLETE_REVERT_DELAY_MS = 3000;

export class StatusBar {
	private intervalId: number | null = null;
	private completeTimerId: number | null = null;
	private recordingStartTime: number = 0;
	private currentContext: StateContext = {};
	private readonly observer: StateObserver;
	private readonly handleClick: () => void;

	constructor(
		private readonly el: HTMLElement,
		private readonly stateManager: StateManager,
		private readonly onStartRecording: () => void,
		private readonly onStopRecording: () => void,
		private readonly onOpenNote: (path: string) => void,
		private readonly onShowError: (error: Error) => void,
		private readonly warningThresholdSeconds: number = 0,
	) {
		this.el.setAttribute('aria-live', 'polite');

		this.observer = (newState: PluginState, _oldState: PluginState, context: StateContext) =>
			this.onStateChange(newState, context);
		this.stateManager.subscribe(this.observer);

		this.handleClick = () => {
			const state = this.stateManager.getState();
			if (state === PluginState.Idle) {
				this.onStartRecording();
			} else if (state === PluginState.Recording) {
				this.onStopRecording();
			} else if (state === PluginState.Complete) {
				if (this.currentContext.noteFilePath) {
					this.onOpenNote(this.currentContext.noteFilePath);
				}
			} else if (state === PluginState.Error) {
				if (this.currentContext.error) {
					this.onShowError(this.currentContext.error);
				}
			}
		};
		this.el.addEventListener('click', this.handleClick);

		this.renderIdle();
		logger.debug('StatusBar', 'Initialized');
	}

	private onStateChange(newState: PluginState, context: StateContext): void {
		this.clearCompleteTimer();
		this.currentContext = context;

		switch (newState) {
			case PluginState.Recording:
				this.stopTimer();
				this.startTimer();
				this.renderRecording(0);
				break;
			case PluginState.Processing:
				this.stopTimer();
				this.renderProcessing(context);
				break;
			case PluginState.Complete:
				this.stopTimer();
				this.renderComplete();
				this.startCompleteTimer();
				break;
			case PluginState.Error:
				this.stopTimer();
				this.renderError();
				break;
			default:
				this.stopTimer();
				this.renderIdle();
				break;
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

	private renderProcessing(context: StateContext): void {
		const stepName = (context.step && STEP_DISPLAY_NAMES[context.step]) || 'Processing';
		let text = `⏳ ${stepName}...`;
		if (context.progress != null && context.totalSteps != null) {
			text += ` (${context.progress}/${context.totalSteps})`;
		}
		this.el.textContent = text;
		this.el.style.color = 'var(--text-muted)';
	}

	private renderComplete(): void {
		this.el.textContent = '✅ Note ready';
		this.el.style.color = 'var(--interactive-accent)';
	}

	private renderError(): void {
		this.el.textContent = '⚠️ Processing failed';
		this.el.style.color = 'var(--text-error)';
	}

	private startCompleteTimer(): void {
		this.completeTimerId = window.setTimeout(() => {
			this.completeTimerId = null;
			this.stateManager.setState(PluginState.Idle);
		}, COMPLETE_REVERT_DELAY_MS);
	}

	private clearCompleteTimer(): void {
		if (this.completeTimerId !== null) {
			window.clearTimeout(this.completeTimerId);
			this.completeTimerId = null;
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
		this.clearCompleteTimer();
		this.stateManager.unsubscribe(this.observer);
		this.el.removeEventListener('click', this.handleClick);
		logger.debug('StatusBar', 'Destroyed');
	}
}
