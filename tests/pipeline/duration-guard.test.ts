// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDurationGuard } from '../../src/pipeline/duration-guard';
import type { MeetingScribeSettings } from '../../src/settings/settings';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import type { App } from 'obsidian';

// Mock estimateAudioDuration
vi.mock('../../src/utils/audio-utils', () => ({
	estimateAudioDuration: vi.fn(),
}));

// Mock provider registry
vi.mock('../../src/providers/provider-registry', () => ({
	providerRegistry: {
		getSTTProvider: vi.fn(),
	},
}));

// Mock DurationGuardModal
vi.mock('../../src/ui/duration-guard-modal', () => {
	let resolveValue = { action: 'cancel' as const };

	return {
		DurationGuardModal: vi.fn().mockImplementation(() => ({
			open: vi.fn(),
			close: vi.fn(),
			onOpen: vi.fn(),
			onClose: vi.fn(),
			getResult: vi.fn().mockImplementation(() => Promise.resolve(resolveValue)),
			contentEl: document.createElement('div'),
		})),
		__setResolveValue: (val: unknown) => { resolveValue = val as typeof resolveValue; },
	};
});

import { estimateAudioDuration } from '../../src/utils/audio-utils';
import { __setResolveValue } from '../../src/ui/duration-guard-modal';
import { providerRegistry } from '../../src/providers/provider-registry';

function createMockApp(): App {
	return {} as App;
}

function createSettings(overrides: Partial<MeetingScribeSettings> = {}): MeetingScribeSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function setupProviderRegistry(): void {
	vi.mocked(providerRegistry.getSTTProvider).mockImplementation((id: string) => {
		switch (id) {
			case 'openai':
				return {
					id: 'openai',
					name: 'OpenAI',
					getSupportedModels: () => [
						{ id: 'whisper-1', name: 'Whisper v1', supportsDiarization: false },
						{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini', supportsDiarization: false },
						{ id: 'gpt-4o-transcribe', name: 'GPT-4o', supportsDiarization: false },
						{ id: 'gpt-4o-transcribe-diarize', name: 'GPT-4o Diarize', supportsDiarization: true },
					],
					getMaxDuration: () => null,
					transcribe: vi.fn(),
				} as any;
			case 'clova':
				return {
					id: 'clova',
					name: 'CLOVA Speech',
					getSupportedModels: () => [
						{ id: 'clova-sync', name: 'CLOVA Speech (Sync)', supportsDiarization: true },
					],
					getMaxDuration: () => 7200,
					transcribe: vi.fn(),
				} as any;
			case 'gemini':
				return {
					id: 'gemini',
					name: 'Gemini',
					getSupportedModels: () => [
						{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportsDiarization: true },
						{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportsDiarization: true },
					],
					getMaxDuration: () => 34200,
					transcribe: vi.fn(),
				} as any;
			default:
				return undefined as any;
		}
	});
}

describe('checkDurationGuard', () => {
	const audio = new ArrayBuffer(1024);
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = createMockApp();
		setupProviderRegistry();
	});

	it('should proceed when duration is within limit', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(1200); // 20 min
		const settings = createSettings({
			sttProvider: 'openai',
			sttModel: 'gpt-4o-transcribe-diarize',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'proceed' });
	});

	it('should proceed when provider has no duration limit', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(999999);
		const settings = createSettings({
			sttProvider: 'openai',
			sttModel: 'gpt-4o-mini-transcribe',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'proceed' });
	});

	it('should show modal when duration exceeds limit', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(8000); // > 7200s CLOVA limit
		(__setResolveValue as (val: unknown) => void)({ action: 'split' });

		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result.action).toBe('split');
	});

	it('should return split with maxDurationSeconds when user chooses split', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(8000);
		(__setResolveValue as (val: unknown) => void)({ action: 'split' });

		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'split', maxDurationSeconds: 7200 });
	});

	it('should return cancel when user cancels', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(8000);
		(__setResolveValue as (val: unknown) => void)({ action: 'cancel' });

		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'cancel' });
	});

	it('should return switch with provider and model when user switches', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(8000);
		(__setResolveValue as (val: unknown) => void)({
			action: 'switch',
			switchProvider: 'gemini',
			switchModel: 'gemini-2.5-flash',
		});

		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({
			action: 'switch',
			switchedProvider: 'gemini',
			switchedModel: 'gemini-2.5-flash',
		});
	});

	it('should proceed for CLOVA within limit', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(3600); // 1 hr < 2 hr limit
		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'proceed' });
	});

	it('should show modal for CLOVA exceeding limit', async () => {
		vi.mocked(estimateAudioDuration).mockResolvedValue(8000); // > 7200s
		(__setResolveValue as (val: unknown) => void)({ action: 'cancel' });

		const settings = createSettings({
			sttProvider: 'clova',
			sttModel: 'clova-sync',
		});

		const result = await checkDurationGuard(audio, settings, app);
		expect(result).toEqual({ action: 'cancel' });
	});
});
