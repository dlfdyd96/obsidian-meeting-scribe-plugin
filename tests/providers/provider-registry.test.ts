import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../src/providers/provider-registry';
import { STTProvider, LLMProvider } from '../../src/providers/types';
import { logger } from '../../src/utils/logger';

function createMockSTTProvider(name: string): STTProvider {
	return {
		name,
		transcribe: vi.fn().mockResolvedValue({
			version: 1,
			audioFile: 'test.webm',
			provider: name,
			model: 'test-model',
			language: 'en',
			segments: [],
			fullText: 'test transcription',
			createdAt: new Date().toISOString(),
		}),
		validateApiKey: vi.fn().mockResolvedValue(true),
		getSupportedModels: vi.fn().mockReturnValue([
			{ id: 'test-model', name: 'Test Model', supportsDiarization: false },
		]),
	};
}

function createMockLLMProvider(name: string): LLMProvider {
	return {
		name,
		summarize: vi.fn().mockResolvedValue({
			version: 1,
			provider: name,
			model: 'test-model',
			summary: 'test summary',
			createdAt: new Date().toISOString(),
		}),
		validateApiKey: vi.fn().mockResolvedValue(true),
		getSupportedModels: vi.fn().mockReturnValue([
			{ id: 'test-model', name: 'Test Model' },
		]),
	};
}

describe('ProviderRegistry', () => {
	let registry: ProviderRegistry;

	beforeEach(() => {
		registry = new ProviderRegistry();
		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
	});

	describe('STT Provider Registration', () => {
		it('should register an STT provider', () => {
			const provider = createMockSTTProvider('openai');
			registry.registerSTTProvider(provider);

			expect(registry.getSTTProvider('openai')).toBe(provider);
		});

		it('should retrieve registered STT provider by name', () => {
			const provider = createMockSTTProvider('openai');
			registry.registerSTTProvider(provider);

			const retrieved = registry.getSTTProvider('openai');
			expect(retrieved).toBeDefined();
			expect(retrieved?.name).toBe('openai');
		});

		it('should return undefined for unregistered STT provider', () => {
			expect(registry.getSTTProvider('nonexistent')).toBeUndefined();
		});

		it('should throw error on duplicate STT provider name', () => {
			const provider1 = createMockSTTProvider('openai');
			const provider2 = createMockSTTProvider('openai');
			registry.registerSTTProvider(provider1);

			expect(() => registry.registerSTTProvider(provider2)).toThrow(
				"STT provider 'openai' is already registered"
			);
		});

		it('should list all registered STT provider names', () => {
			registry.registerSTTProvider(createMockSTTProvider('openai'));
			registry.registerSTTProvider(createMockSTTProvider('whisper'));

			const names = registry.getRegisteredSTTProviders();
			expect(names).toEqual(['openai', 'whisper']);
		});
	});

	describe('LLM Provider Registration', () => {
		it('should register an LLM provider', () => {
			const provider = createMockLLMProvider('openai');
			registry.registerLLMProvider(provider);

			expect(registry.getLLMProvider('openai')).toBe(provider);
		});

		it('should retrieve registered LLM provider by name', () => {
			const provider = createMockLLMProvider('openai');
			registry.registerLLMProvider(provider);

			const retrieved = registry.getLLMProvider('openai');
			expect(retrieved).toBeDefined();
			expect(retrieved?.name).toBe('openai');
		});

		it('should return undefined for unregistered LLM provider', () => {
			expect(registry.getLLMProvider('nonexistent')).toBeUndefined();
		});

		it('should throw error on duplicate LLM provider name', () => {
			const provider1 = createMockLLMProvider('openai');
			const provider2 = createMockLLMProvider('openai');
			registry.registerLLMProvider(provider1);

			expect(() => registry.registerLLMProvider(provider2)).toThrow(
				"LLM provider 'openai' is already registered"
			);
		});

		it('should list all registered LLM provider names', () => {
			registry.registerLLMProvider(createMockLLMProvider('openai'));
			registry.registerLLMProvider(createMockLLMProvider('anthropic'));

			const names = registry.getRegisteredLLMProviders();
			expect(names).toEqual(['openai', 'anthropic']);
		});
	});

	describe('Multiple Providers', () => {
		it('should support registering multiple STT providers', () => {
			registry.registerSTTProvider(createMockSTTProvider('openai'));
			registry.registerSTTProvider(createMockSTTProvider('whisper'));
			registry.registerSTTProvider(createMockSTTProvider('deepgram'));

			expect(registry.getRegisteredSTTProviders()).toHaveLength(3);
		});

		it('should support registering multiple LLM providers', () => {
			registry.registerLLMProvider(createMockLLMProvider('openai'));
			registry.registerLLMProvider(createMockLLMProvider('anthropic'));

			expect(registry.getRegisteredLLMProviders()).toHaveLength(2);
		});

		it('should keep STT and LLM registries independent', () => {
			registry.registerSTTProvider(createMockSTTProvider('openai'));
			registry.registerLLMProvider(createMockLLMProvider('openai'));

			expect(registry.getRegisteredSTTProviders()).toEqual(['openai']);
			expect(registry.getRegisteredLLMProviders()).toEqual(['openai']);
			expect(registry.getSTTProvider('openai')).toBeDefined();
			expect(registry.getLLMProvider('openai')).toBeDefined();
		});
	});
});
