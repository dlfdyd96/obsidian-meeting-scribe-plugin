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
	let onOpenNote: ReturnType<typeof vi.fn>;
	let onShowError: ReturnType<typeof vi.fn>;
	let statusBar: StatusBar;

	beforeEach(() => {
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		el = document.createElement('div');
		stateManager = new StateManager();
		onStart = vi.fn();
		onStop = vi.fn();
		onOpenNote = vi.fn();
		onShowError = vi.fn();
		statusBar = new StatusBar(el, stateManager, onStart, onStop, onOpenNote, onShowError);
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
			const warningBar = new StatusBar(el, stateManager, onStart, onStop, onOpenNote, onShowError, 5);
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

	describe('Processing state display', () => {
		it('should display step name with hourglass emoji and muted color', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			expect(el.textContent).toBe('⏳ Transcribing...');
			expect(el.style.color).toBe('var(--text-muted)');
		});

		it('should update text when context.step changes', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			expect(el.textContent).toBe('⏳ Transcribing...');

			stateManager.setState(PluginState.Processing, { step: 'summarizing' });
			expect(el.textContent).toBe('⏳ Summarizing...');

			stateManager.setState(PluginState.Processing, { step: 'generating' });
			expect(el.textContent).toBe('⏳ Creating note...');
		});

		it('should show progress "(2/3)" when totalSteps present', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing', progress: 2, totalSteps: 3 });
			expect(el.textContent).toBe('⏳ Transcribing... (2/3)');
		});

		it('should fallback to "Processing" for unknown step names', () => {
			stateManager.setState(PluginState.Processing, { step: 'unknown-step' });
			expect(el.textContent).toBe('⏳ Processing...');
		});

		it('should not call any callbacks on click during Processing', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			el.click();
			expect(onStart).not.toHaveBeenCalled();
			expect(onStop).not.toHaveBeenCalled();
			expect(onOpenNote).not.toHaveBeenCalled();
			expect(onShowError).not.toHaveBeenCalled();
		});
	});

	describe('Complete state display', () => {
		it('should display "✅ Note ready" with accent color', () => {
			stateManager.setState(PluginState.Complete, { noteFilePath: 'notes/meeting.md' });
			expect(el.textContent).toBe('✅ Note ready');
			expect(el.style.color).toBe('var(--interactive-accent)');
		});

		it('should call onOpenNote with noteFilePath on click', () => {
			stateManager.setState(PluginState.Complete, { noteFilePath: 'notes/meeting.md' });
			el.click();
			expect(onOpenNote).toHaveBeenCalledWith('notes/meeting.md');
		});

		describe('auto-revert timer', () => {
			beforeEach(() => {
				vi.useFakeTimers();
			});

			afterEach(() => {
				vi.useRealTimers();
			});

			it('should auto-revert to Idle after 3 seconds', async () => {
				stateManager.setState(PluginState.Complete, { noteFilePath: 'notes/meeting.md' });
				expect(el.textContent).toBe('✅ Note ready');

				await vi.advanceTimersByTimeAsync(3000);
				expect(stateManager.getState()).toBe(PluginState.Idle);
				expect(el.textContent).toBe('🎙 Meeting Scribe');
			});

			it('should clear auto-revert timer when state changes before 3s', async () => {
				stateManager.setState(PluginState.Complete, { noteFilePath: 'notes/meeting.md' });

				// State changes before 3s elapsed
				stateManager.setState(PluginState.Idle);
				expect(el.textContent).toBe('🎙 Meeting Scribe');

				// Advance past 3s — should NOT trigger another Idle transition
				await vi.advanceTimersByTimeAsync(3000);
				expect(el.textContent).toBe('🎙 Meeting Scribe');
			});
		});
	});

	describe('Error state display', () => {
		it('should display "⚠️ Processing failed" with error color', () => {
			const testError = new Error('API timeout');
			stateManager.setState(PluginState.Error, { error: testError });
			expect(el.textContent).toBe('⚠️ Processing failed');
			expect(el.style.color).toBe('var(--text-error)');
		});

		it('should call onShowError with error on click', () => {
			const testError = new Error('API timeout');
			stateManager.setState(PluginState.Error, { error: testError });
			el.click();
			expect(onShowError).toHaveBeenCalledWith(testError);
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
