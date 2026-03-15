// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusBar } from '../../src/ui/status-bar';
import { StateManager } from '../../src/state/state-manager';
import { PluginState } from '../../src/state/types';
import { logger } from '../../src/utils/logger';

describe('StatusBar', () => {
	let el: HTMLElement;
	let stateManager: StateManager;
	let onStart: ReturnType<typeof vi.fn>;
	let onStop: ReturnType<typeof vi.fn>;
	let statusBar: StatusBar;

	beforeEach(() => {
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		el = document.createElement('div');
		stateManager = new StateManager();
		onStart = vi.fn();
		onStop = vi.fn();
		statusBar = new StatusBar(el, stateManager, onStart, onStop);
	});

	afterEach(() => {
		statusBar.destroy();
		vi.restoreAllMocks();
	});

	describe('Idle state display', () => {
		it('should display "🎙 Meeting Scribe" text', () => {
			expect(el.textContent).toBe('🎙 Meeting Scribe');
		});

		it('should apply --text-muted color via CSS variable', () => {
			expect(el.style.color).toBe('var(--text-muted)');
		});

		it('should start recording on click', () => {
			el.click();
			expect(onStart).toHaveBeenCalledOnce();
		});

		it('should set aria-live attribute for accessibility', () => {
			expect(el.getAttribute('aria-live')).toBe('polite');
		});
	});

	describe('Recording state display', () => {
		it('should display "🔴 Recording 0:00" on state transition to Recording', () => {
			stateManager.setState(PluginState.Recording);
			expect(el.textContent).toBe('🔴 Recording 0:00');
		});

		it('should apply --text-error color via CSS variable', () => {
			stateManager.setState(PluginState.Recording);
			expect(el.style.color).toBe('var(--text-error)');
		});

		it('should stop recording on click', () => {
			stateManager.setState(PluginState.Recording);
			el.click();
			expect(onStop).toHaveBeenCalledOnce();
		});

		it('should not call start when clicking during recording', () => {
			stateManager.setState(PluginState.Recording);
			el.click();
			expect(onStart).not.toHaveBeenCalled();
		});
	});

	describe('elapsed time timer', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should update elapsed time every second using setInterval', () => {
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(3000);
			expect(el.textContent).toBe('🔴 Recording 0:03');
		});

		it('should display MM:SS format for under 1 hour', () => {
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(125000); // 2m 5s
			expect(el.textContent).toBe('🔴 Recording 2:05');
		});

		it('should display H:MM:SS format for 1 hour or more', () => {
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(3661000); // 1h 1m 1s
			expect(el.textContent).toBe('🔴 Recording 1:01:01');
		});

		it('should clear interval when state leaves Recording', () => {
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(5000);
			expect(el.textContent).toBe('🔴 Recording 0:05');

			stateManager.setState(PluginState.Idle);
			expect(el.textContent).toBe('🎙 Meeting Scribe');

			// Timer should be stopped — advancing time should not change text
			vi.advanceTimersByTime(5000);
			expect(el.textContent).toBe('🎙 Meeting Scribe');
		});
	});

	describe('time warning (UX-DR12)', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should apply --text-warning color when elapsed time exceeds threshold', () => {
			const warningBar = new StatusBar(el, stateManager, onStart, onStop, 5);
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(5000);
			expect(el.style.color).toBe('var(--text-warning)');
			warningBar.destroy();
		});

		it('should not apply warning when threshold is 0 (disabled)', () => {
			stateManager.setState(PluginState.Recording);
			vi.advanceTimersByTime(10000);
			expect(el.style.color).toBe('var(--text-error)');
		});
	});

	describe('StateManager subscription', () => {
		it('should subscribe to StateManager on creation', () => {
			// Verify by transitioning state — display should update
			stateManager.setState(PluginState.Recording);
			expect(el.textContent).toBe('🔴 Recording 0:00');
		});

		it('should unsubscribe on destroy', () => {
			statusBar.destroy();
			stateManager.setState(PluginState.Recording);
			// After destroy, state changes should NOT update the display
			expect(el.textContent).toBe('🎙 Meeting Scribe');
		});
	});

	describe('click guards for non-handled states', () => {
		it('should not call start or stop when in Processing state', () => {
			stateManager.setState(PluginState.Processing);
			el.click();
			expect(onStart).not.toHaveBeenCalled();
			expect(onStop).not.toHaveBeenCalled();
		});
	});
});
