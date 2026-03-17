export interface STTOptions {
	model: string;
	language?: string;
	audioMimeType?: string;
	audioFileName?: string;
}

export interface STTModel {
	id: string;
	name: string;
	supportsDiarization: boolean;
}

export interface TranscriptionSegment {
	speaker?: string;
	start: number;
	end: number;
	text: string;
}

export interface TranscriptionResult {
	version: number;
	audioFile: string;
	provider: string;
	model: string;
	language: string;
	segments: TranscriptionSegment[];
	fullText: string;
	createdAt: string;
}

export interface STTProvider {
	readonly name: string;
	transcribe(audio: ArrayBuffer, options: STTOptions): Promise<TranscriptionResult>;
	validateApiKey(key: string): Promise<boolean>;
	getSupportedModels(): STTModel[];
}

export interface LLMModel {
	id: string;
	name: string;
}

export interface MeetingMetadata {
	date?: string;
	title?: string;
	participants?: string[];
	topics?: string[];
	tags?: string[];
}

export interface SummaryResult {
	version: number;
	provider: string;
	model: string;
	summary: string;
	metadata?: MeetingMetadata;
	createdAt: string;
}

export interface LLMProvider {
	readonly name: string;
	summarize(systemPrompt: string, userPrompt: string): Promise<SummaryResult>;
	validateApiKey(key: string): Promise<boolean>;
	getSupportedModels(): LLMModel[];
}
