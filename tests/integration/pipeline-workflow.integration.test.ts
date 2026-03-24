/**
 * E2E Pipeline Workflow Integration Test
 *
 * Tests the full pipeline chain: TranscribeStep → SummarizeStep → GenerateNoteStep
 * with real API calls to STT (OpenAI) and LLM (Anthropic) providers.
 *
 * Requires: OPENAI_API_KEY + ANTHROPIC_API_KEY environment variables.
 * Skips gracefully if credentials are not available.
 *
 * Created as Epic 10/11 retro action item: "At least 1 full pipeline scenario"
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { hasEnvVars, requireEnv } from './helpers/env-guard';
import { Pipeline } from '../../src/pipeline/pipeline';
import { TranscribeStep } from '../../src/pipeline/steps/transcribe-step';
import { SummarizeStep } from '../../src/pipeline/steps/summarize-step';
import { GenerateNoteStep } from '../../src/pipeline/steps/generate-note-step';
import { providerRegistry } from '../../src/providers/provider-registry';
import { OpenAISTTProvider } from '../../src/providers/stt/openai-stt-provider';
import { AnthropicLLMProvider } from '../../src/providers/llm/anthropic-llm-provider';
import { OpenAILLMProvider } from '../../src/providers/llm/openai-llm-provider';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import type { PipelineContext, PipelineCallbacks } from '../../src/pipeline/pipeline-types';
import type { MeetingScribeSettings } from '../../src/settings/settings';
import { TFile } from 'obsidian';
import type { Vault } from 'obsidian';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// Determine which providers are available
const hasOpenAI = hasEnvVars('OPENAI_API_KEY');
const hasAnthropic = hasEnvVars('ANTHROPIC_API_KEY');
const hasBothProviders = hasOpenAI && hasAnthropic;
// Fallback: OpenAI for both STT and LLM if no Anthropic
const hasOpenAIOnly = hasOpenAI && !hasAnthropic;
const canRun = hasBothProviders || hasOpenAIOnly;

describe.skipIf(!canRun)('Pipeline Workflow E2E Integration', () => {
	let audioData: ArrayBuffer;
	let settings: MeetingScribeSettings;
	let mockVault: Vault;
	const createdFiles: Map<string, string> = new Map();
	const createdBinaryFiles: Map<string, ArrayBuffer> = new Map();

	beforeAll(() => {
		// Register providers (skip if already registered from prior test)
		try { providerRegistry.registerSTTProvider(new OpenAISTTProvider()); } catch { /* already registered */ }
		if (hasAnthropic) {
			try { providerRegistry.registerLLMProvider(new AnthropicLLMProvider()); } catch { /* already registered */ }
		}
		if (hasOpenAI) {
			try { providerRegistry.registerLLMProvider(new OpenAILLMProvider()); } catch { /* already registered */ }
		}

		// Load test audio fixture
		const buffer = readFileSync(resolve(FIXTURES_DIR, 'test-audio.m4a'));
		audioData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

		// Configure settings with real API keys
		settings = {
			...DEFAULT_SETTINGS,
			sttProvider: 'openai',
			sttApiKey: requireEnv('OPENAI_API_KEY'),
			sttModel: 'whisper-1',
			sttLanguage: 'en',
			llmProvider: hasAnthropic ? 'anthropic' : 'openai',
			llmApiKey: hasAnthropic ? requireEnv('ANTHROPIC_API_KEY') : requireEnv('OPENAI_API_KEY'),
			outputFolder: 'Meeting Notes',
			includeTranscript: true,
			separateTranscriptFile: false,
			summaryLanguage: 'en',
		};

		// Create mock vault that serves audio and captures output files
		const audioFilePath = '_attachments/audio/test-audio.m4a';
		const mockTFile = new TFile(audioFilePath);

		mockVault = {
			getAbstractFileByPath: vi.fn((path: string) => {
				// Serve the audio file
				if (path === audioFilePath) return mockTFile;
				// Check created files
				if (createdFiles.has(path)) return { path };
				return null;
			}),
			readBinary: vi.fn(async () => audioData),
			read: vi.fn(async (file: { path: string }) => {
				return createdFiles.get(file.path) ?? '';
			}),
			create: vi.fn(async (path: string, content: string) => {
				createdFiles.set(path, content);
				return { path };
			}),
			modify: vi.fn(async (file: { path: string }, content: string) => {
				createdFiles.set(file.path, content);
			}),
			createFolder: vi.fn(async () => {}),
			adapter: {
				exists: vi.fn(async () => false),
				read: vi.fn(async (path: string) => createdFiles.get(path) ?? ''),
				write: vi.fn(async (path: string, content: string) => {
					createdFiles.set(path, content);
				}),
			},
			getFiles: vi.fn(() => []),
		} as unknown as Vault;
	});

	it('should execute full pipeline: transcribe → summarize → generate note', async () => {
		const stepsCompleted: string[] = [];
		let finalContext: PipelineContext | undefined;

		const callbacks: PipelineCallbacks = {
			onStepStart: (_index, stepName) => {
				console.log(`  [Pipeline] Starting step: ${stepName}`);
			},
			onStepComplete: (_index, stepName) => {
				stepsCompleted.push(stepName);
				console.log(`  [Pipeline] Completed step: ${stepName}`);
			},
			onError: (_index, stepName, error) => {
				console.error(`  [Pipeline] Error in step ${stepName}: ${error.message}`);
			},
			onComplete: (context) => {
				finalContext = context;
				console.log(`  [Pipeline] Complete! Note: ${context.noteFilePath}`);
			},
		};

		const context: PipelineContext = {
			audioFilePath: '_attachments/audio/test-audio.m4a',
			vault: mockVault,
			settings,
			onProgress: (step, current, total) => {
				console.log(`  [Progress] ${step}: ${current}/${total}`);
			},
		};

		const pipeline = new Pipeline();
		const steps = [new TranscribeStep(), new SummarizeStep(), new GenerateNoteStep()];

		const result = await pipeline.execute(steps, context, callbacks);

		// --- STEP COMPLETION VALIDATION ---
		expect(result.failedStepIndex).toBeUndefined();
		expect(stepsCompleted).toEqual(['transcribe', 'summarize', 'generate-note']);

		// --- TRANSCRIPTION VALIDATION (Semantic) ---
		const transcriptionResult = result.context.transcriptionResult;
		expect(transcriptionResult).toBeDefined();
		expect(transcriptionResult!.provider).toBe('openai');
		expect(transcriptionResult!.model).toBe('whisper-1');
		expect(transcriptionResult!.segments.length).toBeGreaterThan(0);
		expect(transcriptionResult!.fullText.length).toBeGreaterThan(10);
		expect(transcriptionResult!.version).toBe(1);

		// Semantic: Segments have reasonable timestamps
		for (const segment of transcriptionResult!.segments) {
			expect(segment.start).toBeGreaterThanOrEqual(0);
			expect(segment.end).toBeGreaterThan(segment.start);
			expect(segment.text.length).toBeGreaterThan(0);
		}

		// Semantic: Timestamps are in seconds (not minutes) — Epic 10 bug prevention
		const maxEnd = Math.max(...transcriptionResult!.segments.map(s => s.end));
		// Test audio is ~5 seconds, so max timestamp should be < 60 (rules out minutes)
		expect(maxEnd).toBeLessThan(60);
		expect(maxEnd).toBeGreaterThan(0);

		// --- SUMMARY VALIDATION (Semantic) ---
		const summaryResult = result.context.summaryResult;
		expect(summaryResult).toBeDefined();
		expect(summaryResult!.provider).toBe(hasAnthropic ? 'anthropic' : 'openai');
		expect(summaryResult!.summary.length).toBeGreaterThan(20);
		expect(summaryResult!.version).toBe(1);

		// --- NOTE GENERATION VALIDATION ---
		expect(result.context.noteFilePath).toBeDefined();
		expect(result.context.noteFilePath).toMatch(/^Meeting Notes\/.+\.md$/);

		// Verify the note file was actually created in mock vault
		expect(createdFiles.has(result.context.noteFilePath!)).toBe(true);

		const noteContent = createdFiles.get(result.context.noteFilePath!)!;
		expect(noteContent.length).toBeGreaterThan(50);

		// Note should have frontmatter
		expect(noteContent).toMatch(/^---\n/);
		expect(noteContent).toContain('created_by: meeting-scribe');

		// Note should contain summary content (not empty body)
		const bodyStart = noteContent.indexOf('---', 4);
		const body = noteContent.slice(bodyStart + 4);
		expect(body.trim().length).toBeGreaterThan(20);

		// --- TRANSCRIPT FILE VALIDATION ---
		// TranscribeStep saves transcript as JSON
		const transcriptPath = '_attachments/audio/test-audio.m4a.transcript.json';
		const transcriptSaved = createdFiles.has(transcriptPath);
		expect(transcriptSaved).toBe(true);

		const transcriptJson = JSON.parse(createdFiles.get(transcriptPath)!);
		expect(transcriptJson.version).toBe(1);
		expect(transcriptJson.segments.length).toBeGreaterThan(0);

		// --- CALLBACKS VALIDATION ---
		expect(finalContext).toBeDefined();
		expect(finalContext!.noteFilePath).toBe(result.context.noteFilePath);
	}, 120_000); // 2 min timeout for real API calls
});
