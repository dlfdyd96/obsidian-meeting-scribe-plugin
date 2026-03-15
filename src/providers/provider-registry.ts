import { STTProvider, LLMProvider } from './types';
import { logger } from '../utils/logger';

export class ProviderRegistry {
	private sttProviders = new Map<string, STTProvider>();
	private llmProviders = new Map<string, LLMProvider>();

	registerSTTProvider(provider: STTProvider): void {
		if (this.sttProviders.has(provider.name)) {
			throw new Error(`STT provider '${provider.name}' is already registered`);
		}
		this.sttProviders.set(provider.name, provider);
		logger.debug('ProviderRegistry', 'STT provider registered', { name: provider.name });
	}

	getSTTProvider(name: string): STTProvider | undefined {
		return this.sttProviders.get(name);
	}

	getRegisteredSTTProviders(): string[] {
		return Array.from(this.sttProviders.keys());
	}

	registerLLMProvider(provider: LLMProvider): void {
		if (this.llmProviders.has(provider.name)) {
			throw new Error(`LLM provider '${provider.name}' is already registered`);
		}
		this.llmProviders.set(provider.name, provider);
		logger.debug('ProviderRegistry', 'LLM provider registered', { name: provider.name });
	}

	getLLMProvider(name: string): LLMProvider | undefined {
		return this.llmProviders.get(name);
	}

	getRegisteredLLMProviders(): string[] {
		return Array.from(this.llmProviders.keys());
	}
}

export const providerRegistry = new ProviderRegistry();
