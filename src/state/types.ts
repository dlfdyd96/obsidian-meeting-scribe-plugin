export enum PluginState {
	Idle = 'Idle',
	Recording = 'Recording',
	Processing = 'Processing',
	Complete = 'Complete',
	Error = 'Error',
}

export interface StateContext {
	step?: string;
	progress?: number;
	totalSteps?: number;
	error?: Error;
	noteFilePath?: string;
}

export type StateObserver = (newState: PluginState, oldState: PluginState, context: StateContext) => void;
