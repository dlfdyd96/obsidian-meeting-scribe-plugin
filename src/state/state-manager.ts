import { logger } from '../utils/logger';
import { PluginState, StateContext, StateObserver } from './types';

export class StateManager {
	private state: PluginState = PluginState.Idle;
	private context: StateContext = {};
	private observers: Set<StateObserver> = new Set();

	getState(): PluginState {
		return this.state;
	}

	getContext(): StateContext {
		return { ...this.context };
	}

	setState(state: PluginState, context?: Partial<StateContext>): void {
		const oldState = this.state;
		this.state = state;

		if (context) {
			this.context = { ...this.context, ...context };
		}

		const logContext: Record<string, unknown> | undefined = context
			? Object.fromEntries(
					Object.entries(context).map(([k, v]) => [
						k,
						v instanceof Error ? v.message : v,
					]),
				)
			: undefined;
		logger.debug('StateManager', `${oldState} → ${state}`, logContext);

		for (const observer of this.observers) {
			try {
				observer(state, oldState, this.getContext());
			} catch (err) {
				logger.error('StateManager', 'Observer error', {
					error: (err as Error).message,
				});
			}
		}
	}

	subscribe(observer: StateObserver): void {
		this.observers.add(observer);
	}

	unsubscribe(observer: StateObserver): void {
		this.observers.delete(observer);
	}

	// For testing only
	reset(): void {
		this.state = PluginState.Idle;
		this.context = {};
		this.observers.clear();
	}
}

export const stateManager = new StateManager();
