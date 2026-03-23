import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSegmentId, loadTranscriptData, saveTranscriptData } from '../../src/transcript/transcript-data';
import type { TranscriptData } from '../../src/transcript/transcript-data';

function createMockVault() {
	return {
		adapter: {
			exists: vi.fn(),
			read: vi.fn(),
			write: vi.fn(),
		},
	} as unknown as import('obsidian').Vault;
}

function makeTranscriptData(overrides: Partial<TranscriptData> = {}): TranscriptData {
	return {
		version: 2,
		audioFile: 'audio/test.m4a',
		duration: 300,
		provider: 'gemini',
		model: 'gemini-2.5-flash',
		language: 'ko',
		segments: [
			{ id: 'seg-1', speaker: 'Participant 1', start: 0, end: 10, text: 'Hello' },
			{ id: 'seg-2', speaker: 'Participant 2', start: 10, end: 20, text: 'Hi there' },
		],
		participants: [
			{ alias: 'Participant 1', name: '', wikiLink: false, color: 0 },
			{ alias: 'Participant 2', name: '', wikiLink: false, color: 1 },
		],
		pipeline: {
			status: 'complete',
			progress: 100,
			completedSteps: ['transcribe', 'summarize', 'generate'],
		},
		meetingNote: '',
		createdAt: '2026-03-24T10:00:00.000Z',
		updatedAt: '2026-03-24T10:00:00.000Z',
		...overrides,
	};
}

describe('generateSegmentId', () => {
	it('should return a non-empty string', () => {
		const id = generateSegmentId();
		expect(id).toBeTruthy();
		expect(typeof id).toBe('string');
		expect(id.length).toBeGreaterThan(0);
	});

	it('should generate unique IDs', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateSegmentId());
		}
		expect(ids.size).toBe(100);
	});
});

describe('loadTranscriptData', () => {
	let vault: ReturnType<typeof createMockVault>;

	beforeEach(() => {
		vault = createMockVault();
	});

	it('should return null when file does not exist', async () => {
		vi.mocked(vault.adapter.exists).mockResolvedValue(false);

		const result = await loadTranscriptData(vault, 'nonexistent.json');
		expect(result).toBeNull();
	});

	it('should load and parse a v2 transcript file', async () => {
		const data = makeTranscriptData();
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue(JSON.stringify(data));

		const result = await loadTranscriptData(vault, 'test.transcript.json');

		expect(result).not.toBeNull();
		expect(result!.version).toBe(2);
		expect(result!.segments).toHaveLength(2);
		expect(result!.participants).toHaveLength(2);
	});

	it('should auto-migrate v1 files and save back', async () => {
		const v1Data = {
			version: 1,
			audioFile: 'audio/test.m4a',
			provider: 'openai',
			model: 'gpt-4o-mini-transcribe',
			language: 'ko',
			segments: [
				{ speaker: 'Participant 1', start: 0, end: 10, text: 'Hello' },
			],
			fullText: 'Hello',
			createdAt: '2026-03-24T10:00:00.000Z',
		};
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue(JSON.stringify(v1Data));
		vi.mocked(vault.adapter.write).mockResolvedValue(undefined);

		const result = await loadTranscriptData(vault, 'test.transcript.json');

		expect(result).not.toBeNull();
		expect(result!.version).toBe(2);
		expect(result!.segments[0].id).toBeTruthy();
		expect(result!.participants).toHaveLength(1);
		expect(result!.pipeline.status).toBe('complete');

		// Should have saved the migrated file back
		expect(vault.adapter.write).toHaveBeenCalledOnce();
	});

	it('should auto-migrate files with missing version field', async () => {
		const noVersionData = {
			audioFile: 'audio/test.m4a',
			provider: 'openai',
			model: 'whisper-1',
			language: 'en',
			segments: [],
			fullText: '',
			createdAt: '2026-01-01T00:00:00.000Z',
		};
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue(JSON.stringify(noVersionData));
		vi.mocked(vault.adapter.write).mockResolvedValue(undefined);

		const result = await loadTranscriptData(vault, 'test.json');

		expect(result).not.toBeNull();
		expect(result!.version).toBe(2);
		expect(result!.segments).toHaveLength(0);
		expect(result!.participants).toHaveLength(0);
	});

	it('should return null on invalid JSON', async () => {
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue('not valid json{{{');

		const result = await loadTranscriptData(vault, 'bad.json');
		expect(result).toBeNull();
	});

	it('should return null on malformed v2 data (missing segments array)', async () => {
		const badV2 = { version: 2, audioFile: 'test.m4a' };
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue(JSON.stringify(badV2));

		const result = await loadTranscriptData(vault, 'bad-v2.json');
		expect(result).toBeNull();
	});

	it('should return null on non-object JSON', async () => {
		vi.mocked(vault.adapter.exists).mockResolvedValue(true);
		vi.mocked(vault.adapter.read).mockResolvedValue('"just a string"');

		const result = await loadTranscriptData(vault, 'string.json');
		expect(result).toBeNull();
	});
});

describe('saveTranscriptData', () => {
	let vault: ReturnType<typeof createMockVault>;

	beforeEach(() => {
		vault = createMockVault();
		vi.mocked(vault.adapter.write).mockResolvedValue(undefined);
	});

	it('should write JSON with 2-space indent', async () => {
		const data = makeTranscriptData();
		await saveTranscriptData(vault, 'test.json', data);

		expect(vault.adapter.write).toHaveBeenCalledOnce();
		const [path, content] = vi.mocked(vault.adapter.write).mock.calls[0];
		expect(path).toBe('test.json');

		const parsed = JSON.parse(content);
		expect(parsed.version).toBe(2);
		// Verify indent by checking raw string has newlines and spaces
		expect(content).toContain('\n  ');
	});

	it('should set updatedAt to current time', async () => {
		const data = makeTranscriptData({ updatedAt: '2020-01-01T00:00:00.000Z' });
		const before = new Date().toISOString();

		await saveTranscriptData(vault, 'test.json', data);

		// Should not mutate the input object
		expect(data.updatedAt).toBe('2020-01-01T00:00:00.000Z');

		// Written JSON should have updated timestamp
		const [, content] = vi.mocked(vault.adapter.write).mock.calls[0];
		const written = JSON.parse(content);
		expect(written.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
		expect(written.updatedAt >= before).toBe(true);
	});
});
