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
	enableSmartChunking: boolean;
	debugMode: boolean;
	onboardingComplete: boolean;
	// CLOVA Speech fields
	clovaInvokeUrl: string;
	clovaSecretKey: string;
	// Gemini STT fields
	geminiApiKey: string;
	// Consent reminder
	showConsentReminder: boolean;
	// Two-file output
	separateTranscriptFile: boolean;
}

export const CURRENT_SETTINGS_VERSION = 9;

export function hasSTTCredentials(settings: MeetingScribeSettings): boolean {
	switch (settings.sttProvider) {
		case 'openai': return !!settings.sttApiKey;
		case 'clova': return !!settings.clovaInvokeUrl && !!settings.clovaSecretKey;
		case 'gemini': return !!settings.geminiApiKey;
		default: return false;
	}
}

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
	enableSmartChunking: false,
	debugMode: false,
	onboardingComplete: false,
	clovaInvokeUrl: '',
	clovaSecretKey: '',
	geminiApiKey: '',
	showConsentReminder: true,
	separateTranscriptFile: false,
};
