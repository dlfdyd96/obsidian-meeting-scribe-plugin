// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RibbonHandler } from '../../src/ui/ribbon-handler';
import { StateManager } from '../../src/state/state-manager';
import { PluginState } from '../../src/state/types';
import { logger } from '../../src/utils/logger';

describe('RibbonHandler', () => {
	let el: HTMLElement;
	let stateManager: StateManager;
	let onStart: ReturnType<typeof vi.fn>;
	let onStop: ReturnType<typeof vi.fn>;
	let ribbonHandler: RibbonHandler;

	beforeEach(() => {
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		el = document.createElement('div');
		stateManager = new StateManager();
		onStart = vi.fn();
		onStop = vi.fn();
		ribbonHandler = new RibbonHandler(el, stateManager, onStart, onStop);
	});

	afterEach(() => {
		ribbonHandler.destroy();
		vi.restoreAllMocks();
	});

	describe('initial state', () => {
		it('should render with "mic" icon', () => {
			expect(el.dataset.icon).toBe('mic');
		});

		it('should set aria-label to "Meeting Scribe: Start Recording"', () => {
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Start Recording');
		});
	});

	describe('Idle → Recording transition', () => {
		it('should change icon to "mic-off" on Recording state', () => {
			stateManager.setState(PluginState.Recording);
			expect(el.dataset.icon).toBe('mic-off');
		});

		it('should apply recording CSS class', () => {
			stateManager.setState(PluginState.Recording);
			expect(el.classList.contains('meeting-scribe-ribbon-recording')).toBe(true);
		});

		it('should update tooltip to "Meeting Scribe: Stop Recording"', () => {
			stateManager.setState(PluginState.Recording);
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Stop Recording');
		});
	});

	describe('Recording → Idle transition', () => {
		beforeEach(() => {
			stateManager.setState(PluginState.Recording);
		});

		it('should revert icon to "mic"', () => {
			stateManager.setState(PluginState.Idle);
			expect(el.dataset.icon).toBe('mic');
		});

		it('should remove recording CSS class', () => {
			stateManager.setState(PluginState.Idle);
			expect(el.classList.contains('meeting-scribe-ribbon-recording')).toBe(false);
		});

		it('should revert tooltip to "Meeting Scribe: Start Recording"', () => {
			stateManager.setState(PluginState.Idle);
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Start Recording');
		});
	});

	describe('Complete state', () => {
		it('should render as Idle when state is Complete', () => {
			stateManager.setState(PluginState.Recording);
			stateManager.setState(PluginState.Complete);
			expect(el.dataset.icon).toBe('mic');
			expect(el.classList.contains('meeting-scribe-ribbon-recording')).toBe(false);
			expect(el.classList.contains('meeting-scribe-ribbon-processing')).toBe(false);
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Start Recording');
		});
	});

	describe('Error state', () => {
		it('should render as Idle when state is Error', () => {
			stateManager.setState(PluginState.Recording);
			stateManager.setState(PluginState.Error);
			expect(el.dataset.icon).toBe('mic');
			expect(el.classList.contains('meeting-scribe-ribbon-recording')).toBe(false);
			expect(el.classList.contains('meeting-scribe-ribbon-processing')).toBe(false);
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Start Recording');
		});
	});

	describe('Processing state', () => {
		it('should apply processing CSS class during Processing', () => {
			stateManager.setState(PluginState.Processing);
			expect(el.classList.contains('meeting-scribe-ribbon-processing')).toBe(true);
		});

		it('should ignore clicks during Processing', () => {
			stateManager.setState(PluginState.Processing);
			el.click();
			expect(onStart).not.toHaveBeenCalled();
			expect(onStop).not.toHaveBeenCalled();
		});

		it('should update tooltip to "Meeting Scribe: Processing"', () => {
			stateManager.setState(PluginState.Processing);
			expect(el.getAttribute('aria-label')).toBe('Meeting Scribe: Processing');
		});
	});

	describe('click handling', () => {
		it('should call onStartRecording in Idle state', () => {
			el.click();
			expect(onStart).toHaveBeenCalledOnce();
		});

		it('should call onStopRecording in Recording state', () => {
			stateManager.setState(PluginState.Recording);
			el.click();
			expect(onStop).toHaveBeenCalledOnce();
		});

		it('should be no-op in Processing state', () => {
			stateManager.setState(PluginState.Processing);
			el.click();
			expect(onStart).not.toHaveBeenCalled();
			expect(onStop).not.toHaveBeenCalled();
		});
	});

	describe('lifecycle', () => {
		it('should subscribe to StateManager on creation', () => {
			const sm = new StateManager();
			const subscribeSpy = vi.spyOn(sm, 'subscribe');
			const handler = new RibbonHandler(document.createElement('div'), sm, vi.fn(), vi.fn());
			expect(subscribeSpy).toHaveBeenCalledOnce();
			handler.destroy();
		});

		it('should unsubscribe on destroy', () => {
			const sm = new StateManager();
			const unsubscribeSpy = vi.spyOn(sm, 'unsubscribe');
			const handler = new RibbonHandler(document.createElement('div'), sm, vi.fn(), vi.fn());
			handler.destroy();
			expect(unsubscribeSpy).toHaveBeenCalledOnce();
		});

		it('should remove click listener on destroy', () => {
			const testEl = document.createElement('div');
			const testOnStart = vi.fn();
			const handler = new RibbonHandler(testEl, new StateManager(), testOnStart, vi.fn());
			handler.destroy();
			testEl.click();
			expect(testOnStart).not.toHaveBeenCalled();
		});
	});
});
