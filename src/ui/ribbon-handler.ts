import { setIcon } from 'obsidian';
import { StateManager } from '../state/state-manager';
import { PluginState } from '../state/types';
import { PLUGIN_NAME } from '../constants';
import { logger } from '../utils/logger';

export class RibbonHandler {
	private readonly observer: (newState: PluginState) => void;
	private readonly handleClick: () => void;

	constructor(
		private readonly el: HTMLElement,
		private readonly stateManager: StateManager,
		private readonly onStartRecording: () => void,
		private readonly onStopRecording: () => void,
	) {
		this.observer = (newState: PluginState) => this.onStateChange(newState);
		this.stateManager.subscribe(this.observer);

		this.handleClick = () => {
			const state = this.stateManager.getState();
			if (state === PluginState.Idle) {
				this.onStartRecording();
			} else if (state === PluginState.Recording) {
				this.onStopRecording();
			}
			// Processing, Complete, Error: no-op
		};
		this.el.addEventListener('click', this.handleClick);

		this.renderIdle();
		logger.debug('RibbonHandler', 'Initialized');
	}

	private onStateChange(newState: PluginState): void {
		switch (newState) {
			case PluginState.Recording:
				this.renderRecording();
				break;
			case PluginState.Processing:
				this.renderProcessing();
				break;
			default:
				this.renderIdle();
				break;
		}
		logger.debug('RibbonHandler', 'State changed', { newState });
	}

	private renderIdle(): void {
		setIcon(this.el, 'mic');
		this.el.classList.remove('meeting-scribe-ribbon-recording', 'meeting-scribe-ribbon-processing');
		this.setTooltipAndAria(`${PLUGIN_NAME}: Start Recording`);
	}

	private renderRecording(): void {
		setIcon(this.el, 'mic-off');
		this.el.classList.remove('meeting-scribe-ribbon-processing');
		this.el.classList.add('meeting-scribe-ribbon-recording');
		this.setTooltipAndAria(`${PLUGIN_NAME}: Stop Recording`);
	}

	private renderProcessing(): void {
		setIcon(this.el, 'mic');
		this.el.classList.remove('meeting-scribe-ribbon-recording');
		this.el.classList.add('meeting-scribe-ribbon-processing');
		this.setTooltipAndAria(`${PLUGIN_NAME}: Processing`);
	}

	private setTooltipAndAria(text: string): void {
		this.el.setAttribute('aria-label', text);
	}

	destroy(): void {
		this.stateManager.unsubscribe(this.observer);
		this.el.removeEventListener('click', this.handleClick);
		logger.debug('RibbonHandler', 'Destroyed');
	}
}
