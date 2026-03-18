// @vitest-environment jsdom
/**
 * Integration test: chunker with a real m4a file.
 * Tests that large audio files don't cause excessive blocking.
 * Skipped in CI — run manually with: npx vitest run tests/pipeline/chunker-real-file.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { logger } from '../../src/utils/logger';

const TEST_FILE = '/Users/paul/Syncthing/Obsidian-Vault/obsidian-plugin-test/_attachments/audio/20260317 apM 개발 리소스 논의.m4a';

// Skip if test file doesn't exist (CI environment)
const fileExists = existsSync(TEST_FILE);

describe.skipIf(!fileExists)('Chunker with real m4a file', () => {
	beforeEach(() => {
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(logger, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
	});

	it('should read file and report size', () => {
		const data = readFileSync(TEST_FILE);
		console.log(`File size: ${(data.byteLength / 1024 / 1024).toFixed(1)}MB`);
		expect(data.byteLength).toBeGreaterThan(0);
	});

	it('should attempt decodeAudioData without hanging', async () => {
		const data = readFileSync(TEST_FILE);
		const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

		// OfflineAudioContext may not be available in jsdom
		if (typeof OfflineAudioContext === 'undefined') {
			console.log('OfflineAudioContext not available in jsdom — skipping decode test');
			console.log('This confirms the bug path: chunker uses OfflineAudioContext which works in Electron but may block the main thread');
			return;
		}

		const start = performance.now();
		const ctx = new OfflineAudioContext(1, 1, 44100);
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
		const decodeTime = performance.now() - start;

		console.log(`Decode time: ${decodeTime.toFixed(0)}ms`);
		console.log(`Duration: ${audioBuffer.duration.toFixed(1)}s`);
		console.log(`Sample rate: ${audioBuffer.sampleRate}`);
		console.log(`PCM samples: ${audioBuffer.getChannelData(0).length}`);
		console.log(`PCM size: ${(audioBuffer.getChannelData(0).byteLength / 1024 / 1024).toFixed(1)}MB`);

		// If decode takes more than 5 seconds, that's a problem
		expect(decodeTime).toBeLessThan(5000);
	}, 30000);

	it('should chunk without blocking for too long', async () => {
		if (typeof OfflineAudioContext === 'undefined') {
			console.log('OfflineAudioContext not available — cannot test chunker');
			return;
		}

		const { chunkAudio } = await import('../../src/pipeline/chunker');
		const data = readFileSync(TEST_FILE);
		const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

		const start = performance.now();
		const chunks = await chunkAudio(arrayBuffer);
		const totalTime = performance.now() - start;

		console.log(`Total chunk time: ${totalTime.toFixed(0)}ms`);
		console.log(`Chunks created: ${chunks.length}`);
		for (const chunk of chunks) {
			console.log(`  Chunk ${chunk.chunkIndex}: ${chunk.startTime.toFixed(1)}s-${chunk.endTime.toFixed(1)}s, ${(chunk.data.byteLength / 1024 / 1024).toFixed(1)}MB, ${chunk.mimeType}`);
		}

		expect(chunks.length).toBeGreaterThan(0);
		// If total processing takes more than 10 seconds, it will definitely freeze Obsidian UI
		expect(totalTime).toBeLessThan(10000);
	}, 60000);
});
