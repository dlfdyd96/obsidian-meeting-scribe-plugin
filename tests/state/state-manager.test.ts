import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stateManager, StateManager } from '../../src/state/state-manager';
import { PluginState } from '../../src/state/types';
import { logger } from '../../src/utils/logger';

describe('StateManager', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stateManager.reset();
		debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initial state', () => {
		it('should have Idle as initial state', () => {
			expect(stateManager.getState()).toBe(PluginState.Idle);
		});

		it('should have empty context initially', () => {
			expect(stateManager.getContext()).toEqual({});
		});
	});

	describe('setState()', () => {
		it('should change state and getState() returns the new state', () => {
			stateManager.setState(PluginState.Recording);
			expect(stateManager.getState()).toBe(PluginState.Recording);
		});

		it('should merge context into existing context', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			expect(stateManager.getContext()).toEqual({ step: 'transcribing' });

			stateManager.setState(PluginState.Processing, { progress: 0.5 });
			expect(stateManager.getContext()).toEqual({ step: 'transcribing', progress: 0.5 });
		});

		it('should log transition via Logger debug', () => {
			stateManager.setState(PluginState.Recording);
			expect(debugSpy).toHaveBeenCalledWith(
				'StateManager',
				'Idle → Recording',
				undefined,
			);
		});

		it('should log transition with context when provided', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			expect(debugSpy).toHaveBeenCalledWith(
				'StateManager',
				'Idle → Processing',
				{ step: 'transcribing' },
			);
		});
	});

	describe('getContext() immutability', () => {
		it('should return a copy — mutating the returned object does not affect internal state', () => {
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			const ctx = stateManager.getContext();
			ctx.step = 'modified';
			ctx.progress = 99;

			expect(stateManager.getContext()).toEqual({ step: 'transcribing' });
		});
	});

	describe('subscribe()', () => {
		it('should add an observer that receives newState, oldState, and context on state change', () => {
			const observer = vi.fn();
			stateManager.subscribe(observer);

			stateManager.setState(PluginState.Recording);
			expect(observer).toHaveBeenCalledWith(PluginState.Recording, PluginState.Idle, {});
		});

		it('should notify multiple observers', () => {
			const observer1 = vi.fn();
			const observer2 = vi.fn();
			stateManager.subscribe(observer1);
			stateManager.subscribe(observer2);

			stateManager.setState(PluginState.Recording);
			expect(observer1).toHaveBeenCalledOnce();
			expect(observer2).toHaveBeenCalledOnce();
		});
	});

	describe('unsubscribe()', () => {
		it('should remove an observer — it no longer receives notifications', () => {
			const observer = vi.fn();
			stateManager.subscribe(observer);
			stateManager.unsubscribe(observer);

			stateManager.setState(PluginState.Recording);
			expect(observer).not.toHaveBeenCalled();
		});
	});

	describe('state transitions', () => {
		it('should handle Idle → Recording → Processing → Complete → Idle', () => {
			const observer = vi.fn();
			stateManager.subscribe(observer);

			stateManager.setState(PluginState.Recording);
			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			stateManager.setState(PluginState.Complete, { noteFilePath: '/notes/meeting.md' });
			stateManager.setState(PluginState.Idle);

			expect(observer).toHaveBeenCalledTimes(4);
			expect(observer).toHaveBeenNthCalledWith(1, PluginState.Recording, PluginState.Idle, {});
			expect(observer).toHaveBeenNthCalledWith(2, PluginState.Processing, PluginState.Recording, { step: 'transcribing' });
			expect(observer).toHaveBeenNthCalledWith(3, PluginState.Complete, PluginState.Processing, { step: 'transcribing', noteFilePath: '/notes/meeting.md' });
			expect(observer).toHaveBeenNthCalledWith(4, PluginState.Idle, PluginState.Complete, { step: 'transcribing', noteFilePath: '/notes/meeting.md' });
		});

		it('should handle Processing → Error, Error → Idle', () => {
			const testError = new Error('STT failed');
			const observer = vi.fn();
			stateManager.subscribe(observer);

			stateManager.setState(PluginState.Processing, { step: 'transcribing' });
			stateManager.setState(PluginState.Error, { error: testError });
			stateManager.setState(PluginState.Idle);

			expect(observer).toHaveBeenCalledTimes(3);
			expect(observer).toHaveBeenNthCalledWith(2, PluginState.Error, PluginState.Processing, { step: 'transcribing', error: testError });
			expect(observer).toHaveBeenNthCalledWith(3, PluginState.Idle, PluginState.Error, { step: 'transcribing', error: testError });
		});
	});

	describe('context across transitions', () => {
		it('should merge context correctly — setting Error with error field, then Idle with new context clears error', () => {
			const testError = new Error('failed');
			stateManager.setState(PluginState.Error, { error: testError });
			expect(stateManager.getContext().error).toBe(testError);

			stateManager.setState(PluginState.Idle, { error: undefined, step: undefined });
			const ctx = stateManager.getContext();
			expect(ctx.error).toBeUndefined();
			expect(ctx.step).toBeUndefined();
		});
	});

	describe('singleton', () => {
		it('should export a singleton instance', () => {
			expect(stateManager).toBeInstanceOf(StateManager);
		});
	});

	describe('observer error safety', () => {
		it('should isolate observer errors and not propagate them', () => {
			const throwingObserver = vi.fn().mockImplementation(() => {
				throw new Error('observer exploded');
			});
			stateManager.subscribe(throwingObserver);

			expect(() => stateManager.setState(PluginState.Recording)).not.toThrow();
			expect(throwingObserver).toHaveBeenCalled();
		});

		it('should notify remaining observers even if one throws', () => {
			const throwingObserver = vi.fn().mockImplementation(() => {
				throw new Error('observer exploded');
			});
			const healthyObserver = vi.fn();
			stateManager.subscribe(throwingObserver);
			stateManager.subscribe(healthyObserver);

			stateManager.setState(PluginState.Recording);
			expect(healthyObserver).toHaveBeenCalled();
		});

		it('should still update state even if observer throws (state is set before observers are called)', () => {
			const throwingObserver = vi.fn().mockImplementation(() => {
				throw new Error('observer exploded');
			});
			stateManager.subscribe(throwingObserver);

			try {
				stateManager.setState(PluginState.Recording);
			} catch {
				// expected
			}

			expect(stateManager.getState()).toBe(PluginState.Recording);
		});
	});
});
