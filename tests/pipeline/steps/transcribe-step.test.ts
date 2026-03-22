import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, Vault } from 'obsidian';
import { TranscribeStep } from '../../../src/pipeline/steps/transcribe-step';
import type { PipelineContext } from '../../../src/pipeline/pipeline-types';
import type { TranscriptionResult, STTProvider } from '../../../src/providers/types';
import { providerRegistry } from '../../../src/providers/provider-registry';
import { ConfigError, DataError, TransientError } from '../../../src/utils/errors';
import type { AudioChunk } from '../../../src/pipeline/chunker';

// Mock dependencies
vi.mock('../../../src/pipeline/chunker', () => ({
	chunkAudio: vi.fn(),
}));

vi.mock('../../../src/providers/provider-registry', () => ({
	providerRegistry: {
		getSTTProvider: vi.fn(),
	},
}));

vi.mock('../../../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { chunkAudio } from '../../../src/pipeline/chunker';

function makeTranscriptionResult(overrides?: Partial<TranscriptionResult>): TranscriptionResult {
	return {
		version: 1,
		audioFile: 'test.webm',
		provider: 'openai',
		model: 'gpt-4o-mini-transcribe',
		language: 'en',
		segments: [
			{ start: 0, end: 5, text: 'Hello world' },
		],
		fullText: 'Hello world',
		createdAt: '2026-03-16T00:00:00.000Z',
		...overrides,
	};
}

function makeChunk(overrides?: Partial<AudioChunk>): AudioChunk {
	return {
		data: new ArrayBuffer(100),
		chunkIndex: 0,
		startTime: 0,
		endTime: 600,
		mimeType: 'audio/webm',
		fileExtension: 'webm',
		...overrides,
	};
}

function makeMockProvider(): STTProvider {
	return {
		name: 'openai',
		transcribe: vi.fn().mockResolvedValue(makeTranscriptionResult()),
		validateApiKey: vi.fn().mockResolvedValue(true),
		getSupportedModels: vi.fn().mockReturnValue([]),
		setCredentials: vi.fn(),
		getSupportedFormats: vi.fn().mockReturnValue(['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga']),
		getMaxDuration: vi.fn().mockReturnValue(null),
		getRequiredCredentials: vi.fn().mockReturnValue(['apiKey']),
		mapLanguageCode: vi.fn().mockImplementation((lang: string) => lang === 'auto' ? undefined : lang),
	};
}

function makeMockVault(): Vault {
	const vault = new Vault();
	vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
	vault.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(1000));
	vault.read = vi.fn().mockResolvedValue('');
	vault.create = vi.fn().mockResolvedValue(new TFile('test.transcript.json'));
	vault.modify = vi.fn().mockResolvedValue(undefined);
	return vault;
}

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
	return {
		audioFilePath: 'recordings/test.webm',
		vault: makeMockVault(),
		settings: {
			settingsVersion: 1,
			sttProvider: 'openai',
			sttApiKey: 'test-key',
			sttModel: 'gpt-4o-mini-transcribe',
			sttLanguage: 'auto',
			llmProvider: 'anthropic',
			llmApiKey: '',
			llmModel: '',
			outputFolder: 'Meeting Notes',
			audioFolder: '_attachments/audio',
			audioRetentionPolicy: 'keep',
			debugMode: false,
		},
		...overrides,
	};
}

describe('TranscribeStep', () => {
	let step: TranscribeStep;

	beforeEach(() => {
		vi.clearAllMocks();
		step = new TranscribeStep();
	});

	it('has name "transcribe"', () => {
		expect(step.name).toBe('transcribe');
	});

	describe('single-chunk flow', () => {
		it('transcribes a single chunk and returns result', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const singleChunk = makeChunk();
			vi.mocked(chunkAudio).mockResolvedValue([singleChunk]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			const result = await step.execute(context);

			expect(result.transcriptionResult).toBeDefined();
			expect(result.transcriptionResult!.fullText).toBe('Hello world');
			expect(result.transcriptionResult!.audioFile).toBe('recordings/test.webm');
			expect(result.transcriptionResult!.version).toBe(1);
			expect(context.vault.readBinary).toHaveBeenCalledWith(audioFile);
			expect(chunkAudio).toHaveBeenCalled();
			expect(mockProvider.transcribe).toHaveBeenCalledTimes(1);
		});

		it('passes language undefined when sttLanguage is auto', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await step.execute(context);

			expect(mockProvider.transcribe).toHaveBeenCalledWith(
				expect.any(ArrayBuffer),
				{ model: 'gpt-4o-mini-transcribe', language: undefined, audioMimeType: 'audio/webm', audioFileName: 'audio.webm' },
			);
		});

		it('passes language value when sttLanguage is not auto', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext({
				settings: { ...makeContext().settings, sttLanguage: 'ko' },
			});
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await step.execute(context);

			expect(mockProvider.transcribe).toHaveBeenCalledWith(
				expect.any(ArrayBuffer),
				{ model: 'gpt-4o-mini-transcribe', language: 'ko', audioMimeType: 'audio/webm', audioFileName: 'audio.webm' },
			);
		});
	});

	describe('multi-chunk merge with timestamp adjustment', () => {
		it('merges multiple chunks with correct timestamp offsets', async () => {
			const result1 = makeTranscriptionResult({
				segments: [
					{ start: 0, end: 5, text: 'First chunk' },
					{ start: 5, end: 10, text: 'continues' },
				],
				fullText: 'First chunk continues',
			});
			const result2 = makeTranscriptionResult({
				segments: [
					{ start: 0, end: 4, text: 'Second chunk' },
					{ start: 4, end: 8, text: 'here' },
				],
				fullText: 'Second chunk here',
			});

			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe)
				.mockResolvedValueOnce(result1)
				.mockResolvedValueOnce(result2);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const chunk1 = makeChunk({ chunkIndex: 0, startTime: 0, endTime: 600 });
			const chunk2 = makeChunk({ chunkIndex: 1, startTime: 600, endTime: 1200 });
			vi.mocked(chunkAudio).mockResolvedValue([chunk1, chunk2]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			const resultCtx = await step.execute(context);
			const merged = resultCtx.transcriptionResult!;

			expect(merged.segments).toHaveLength(4);
			// First chunk segments (offset 0)
			expect(merged.segments[0]).toEqual({ start: 0, end: 5, text: 'First chunk' });
			expect(merged.segments[1]).toEqual({ start: 5, end: 10, text: 'continues' });
			// Second chunk segments (offset 600)
			expect(merged.segments[2]).toEqual({ start: 600, end: 604, text: 'Second chunk' });
			expect(merged.segments[3]).toEqual({ start: 604, end: 608, text: 'here' });

			expect(merged.fullText).toBe('First chunk continues Second chunk here');
		});

		it('preserves speaker labels during merge', async () => {
			const result1 = makeTranscriptionResult({
				segments: [{ speaker: 'A', start: 0, end: 5, text: 'Hello' }],
				fullText: 'Hello',
			});
			const result2 = makeTranscriptionResult({
				segments: [{ speaker: 'B', start: 0, end: 3, text: 'Hi' }],
				fullText: 'Hi',
			});

			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe)
				.mockResolvedValueOnce(result1)
				.mockResolvedValueOnce(result2);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			vi.mocked(chunkAudio).mockResolvedValue([
				makeChunk({ chunkIndex: 0, startTime: 0 }),
				makeChunk({ chunkIndex: 1, startTime: 600 }),
			]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			const resultCtx = await step.execute(context);

			expect(resultCtx.transcriptionResult!.segments[0]!.speaker).toBe('A');
			expect(resultCtx.transcriptionResult!.segments[1]!.speaker).toBe('B');
		});
	});

	describe('.transcript.json save', () => {
		it('saves transcript as JSON file after successful transcription', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await step.execute(context);

			expect(context.vault.create).toHaveBeenCalledWith(
				'recordings/test.webm.transcript.json',
				expect.any(String),
			);

			const savedJson = vi.mocked(context.vault.create).mock.calls[0]![1] as string;
			const parsed = JSON.parse(savedJson) as TranscriptionResult;
			expect(parsed.audioFile).toBe('recordings/test.webm');
			expect(parsed.version).toBe(1);
		});

		it('uses vault.modify when transcript file already exists (force retranscribe)', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const transcriptFile = new TFile('recordings/test.webm.transcript.json');
			const context = makeContext({ forceRetranscribe: true });

			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				if (path === 'recordings/test.webm.transcript.json') return transcriptFile;
				return null;
			});

			await step.execute(context);

			expect(context.vault.modify).toHaveBeenCalledWith(
				transcriptFile,
				expect.any(String),
			);
			expect(context.vault.create).not.toHaveBeenCalled();
		});
	});

	describe('.transcript.json load (cache)', () => {
		it('returns cached transcript without calling STT API', async () => {
			const cachedResult = makeTranscriptionResult({ fullText: 'Cached text' });
			const transcriptFile = new TFile('recordings/test.webm.transcript.json');

			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm.transcript.json') return transcriptFile;
				return null;
			});
			vi.mocked(context.vault.read).mockResolvedValue(JSON.stringify(cachedResult));

			const result = await step.execute(context);

			expect(result.transcriptionResult).toEqual(cachedResult);
			expect(chunkAudio).not.toHaveBeenCalled();
			expect(providerRegistry.getSTTProvider).not.toHaveBeenCalled();
		});

		it('falls through to re-transcribe when cached transcript is corrupt', async () => {
			const transcriptFile = new TFile('recordings/test.webm.transcript.json');
			const audioFile = new TFile('recordings/test.webm');

			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm.transcript.json') return transcriptFile;
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});
			vi.mocked(context.vault.read).mockResolvedValue('not valid json{{{');

			const result = await step.execute(context);

			expect(result.transcriptionResult).toBeDefined();
			expect(mockProvider.transcribe).toHaveBeenCalled();
		});
	});

	describe('forceRetranscribe', () => {
		it('bypasses cache when forceRetranscribe is true', async () => {
			const cachedResult = makeTranscriptionResult({ fullText: 'Old text' });
			const freshResult = makeTranscriptionResult({ fullText: 'New text' });

			const transcriptFile = new TFile('recordings/test.webm.transcript.json');
			const audioFile = new TFile('recordings/test.webm');

			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe).mockResolvedValue(freshResult);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const context = makeContext({ forceRetranscribe: true });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				if (path === 'recordings/test.webm.transcript.json') return transcriptFile;
				return null;
			});
			vi.mocked(context.vault.read).mockResolvedValue(JSON.stringify(cachedResult));

			const result = await step.execute(context);

			expect(result.transcriptionResult!.fullText).toBe('New text');
			expect(mockProvider.transcribe).toHaveBeenCalled();
		});
	});

	describe('progress callback', () => {
		it('reports progress for each chunk', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			vi.mocked(chunkAudio).mockResolvedValue([
				makeChunk({ chunkIndex: 0 }),
				makeChunk({ chunkIndex: 1 }),
				makeChunk({ chunkIndex: 2 }),
			]);

			const audioFile = new TFile('recordings/test.webm');
			const onProgress = vi.fn();
			const context = makeContext({ onProgress });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await step.execute(context);

			expect(onProgress).toHaveBeenCalledTimes(3);
			expect(onProgress).toHaveBeenNthCalledWith(1, 'transcribing', 1, 3);
			expect(onProgress).toHaveBeenNthCalledWith(2, 'transcribing', 2, 3);
			expect(onProgress).toHaveBeenNthCalledWith(3, 'transcribing', 3, 3);
		});

		it('works without onProgress callback', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			// Should not throw
			await expect(step.execute(context)).resolves.toBeDefined();
		});
	});

	describe('audio format validation', () => {
		it('accepts supported audio formats without error', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			for (const ext of ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga']) {
				const audioFile = new TFile(`recordings/test.${ext}`);
				const context = makeContext({ audioFilePath: `recordings/test.${ext}` });
				vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
					if (path === `recordings/test.${ext}`) return audioFile;
					return null;
				});

				await expect(step.execute(context)).resolves.toBeDefined();
			}
		});

		it('throws ConfigError for unsupported audio format', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const audioFile = new TFile('recordings/test.flac');
			const context = makeContext({ audioFilePath: 'recordings/test.flac' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.flac') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow('flac is not supported by openai');
		});

		it('throws ConfigError for ogg format (not supported by OpenAI)', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const audioFile = new TFile('recordings/test.ogg');
			const context = makeContext({ audioFilePath: 'recordings/test.ogg' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.ogg') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow('ogg is not supported by openai');
		});

		it('throws ConfigError for webm format when using CLOVA provider', async () => {
			const mockProvider = makeMockProvider();
			mockProvider.name = 'clova';
			vi.mocked(mockProvider.getSupportedFormats).mockReturnValue(['mp3', 'm4a', 'wav', 'flac', 'aac']);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext({ audioFilePath: 'recordings/test.webm' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow('webm is not supported by clova');
		});

		it('accepts m4a format when using CLOVA provider', async () => {
			const mockProvider = makeMockProvider();
			mockProvider.name = 'clova';
			vi.mocked(mockProvider.getSupportedFormats).mockReturnValue(['mp3', 'm4a', 'wav', 'flac', 'aac']);
			vi.mocked(mockProvider.transcribe).mockResolvedValue(makeTranscriptionResult({ provider: 'clova' }));
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk({ mimeType: 'audio/mp4', fileExtension: 'm4a' })]);

			const audioFile = new TFile('recordings/test.m4a');
			const context = makeContext({ audioFilePath: 'recordings/test.m4a' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.m4a') return audioFile;
				return null;
			});

			await expect(step.execute(context)).resolves.toBeDefined();
		});

		it('accepts wav format when using CLOVA provider', async () => {
			const mockProvider = makeMockProvider();
			mockProvider.name = 'clova';
			vi.mocked(mockProvider.getSupportedFormats).mockReturnValue(['mp3', 'm4a', 'wav', 'flac', 'aac']);
			vi.mocked(mockProvider.transcribe).mockResolvedValue(makeTranscriptionResult({ provider: 'clova' }));
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk({ mimeType: 'audio/wav', fileExtension: 'wav' })]);

			const audioFile = new TFile('recordings/test.wav');
			const context = makeContext({ audioFilePath: 'recordings/test.wav' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.wav') return audioFile;
				return null;
			});

			await expect(step.execute(context)).resolves.toBeDefined();
		});

		it('throws ConfigError for webm format when using Gemini provider', async () => {
			const mockProvider = makeMockProvider();
			mockProvider.name = 'gemini';
			vi.mocked(mockProvider.getSupportedFormats).mockReturnValue(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac']);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext({ audioFilePath: 'recordings/test.webm' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow('webm is not supported by gemini');
		});

		it('accepts ogg format when using Gemini provider', async () => {
			const mockProvider = makeMockProvider();
			mockProvider.name = 'gemini';
			vi.mocked(mockProvider.getSupportedFormats).mockReturnValue(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac']);
			vi.mocked(mockProvider.transcribe).mockResolvedValue(makeTranscriptionResult({ provider: 'gemini' }));
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk({ mimeType: 'audio/ogg', fileExtension: 'ogg' })]);

			const audioFile = new TFile('recordings/test.ogg');
			const context = makeContext({ audioFilePath: 'recordings/test.ogg' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.ogg') return audioFile;
				return null;
			});

			await expect(step.execute(context)).resolves.toBeDefined();
		});

		it('validates format before chunking (no wasted processing)', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);

			const audioFile = new TFile('recordings/test.aac');
			const context = makeContext({ audioFilePath: 'recordings/test.aac' });
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.aac') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			expect(chunkAudio).not.toHaveBeenCalled();
		});
	});

	describe('error propagation', () => {
		it('throws DataError when audio file not found', async () => {
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockReturnValue(null);

			await expect(step.execute(context)).rejects.toThrow(DataError);
			await expect(step.execute(context)).rejects.toThrow('Audio file not found');
		});

		it('throws ConfigError when STT provider not found', async () => {
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(undefined);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
			await expect(step.execute(context)).rejects.toThrow('STT provider not found');
		});

		it('sets credentials on provider before transcription', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await step.execute(context);

			expect(mockProvider.setCredentials).toHaveBeenCalledWith({ type: 'api-key', apiKey: 'test-key' });
		});

		it('propagates TransientError from provider', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe).mockRejectedValue(
				new TransientError('Rate limited'),
			);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(TransientError);
		});

		it('propagates ConfigError from provider', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe).mockRejectedValue(
				new ConfigError('Invalid API key'),
			);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(ConfigError);
		});

		it('propagates DataError from provider', async () => {
			const mockProvider = makeMockProvider();
			vi.mocked(mockProvider.transcribe).mockRejectedValue(
				new DataError('File too large'),
			);
			vi.mocked(providerRegistry.getSTTProvider).mockReturnValue(mockProvider);
			vi.mocked(chunkAudio).mockResolvedValue([makeChunk()]);

			const audioFile = new TFile('recordings/test.webm');
			const context = makeContext();
			vi.mocked(context.vault.getAbstractFileByPath).mockImplementation((path: string) => {
				if (path === 'recordings/test.webm') return audioFile;
				return null;
			});

			await expect(step.execute(context)).rejects.toThrow(DataError);
		});
	});
});
