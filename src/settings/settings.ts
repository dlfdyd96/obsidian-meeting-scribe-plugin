export interface MeetingScribeSettings {
	settingsVersion: number;
	sttProvider: string;
	sttApiKey: string;
	sttModel: string;
	sttLanguage: string;
	llmProvider: string;
	llmApiKey: string;
	llmModel: string;
	outputFolder: string;
	audioFolder: string;
	audioRetentionPolicy: 'keep' | 'delete';
	summaryLanguage: string;
	includeTranscript: boolean;
	debugMode: boolean;
	onboardingComplete: boolean;
}

export const CURRENT_SETTINGS_VERSION = 4;

export const DEFAULT_SETTINGS: MeetingScribeSettings = {
	settingsVersion: CURRENT_SETTINGS_VERSION,
	sttProvider: 'openai',
	sttApiKey: '',
	sttModel: 'gpt-4o-mini-transcribe',
	sttLanguage: 'auto',
	llmProvider: 'anthropic',
	llmApiKey: '',
	llmModel: '',
	outputFolder: 'Meeting Notes',
	audioFolder: '_attachments/audio',
	audioRetentionPolicy: 'keep',
	summaryLanguage: 'auto',
	includeTranscript: true,
	debugMode: false,
	onboardingComplete: false,
};
