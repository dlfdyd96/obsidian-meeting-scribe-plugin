import type { App } from 'obsidian';
import type { MeetingScribeSettings } from '../settings/settings';
import { hasSTTCredentials } from '../settings/settings';
import { estimateAudioDuration } from '../utils/audio-utils';
import { DurationGuardModal } from '../ui/duration-guard-modal';
import type { DurationGuardAlternative } from '../ui/duration-guard-modal';
import { providerRegistry } from '../providers/provider-registry';
import { logger } from '../utils/logger';

const COMPONENT = 'DurationGuard';

export interface DurationGuardResult {
	action: 'proceed' | 'split' | 'cancel' | 'switch';
	maxDurationSeconds?: number;
	switchedProvider?: string;
	switchedModel?: string;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	openai: 'OpenAI',
	clova: 'CLOVA Speech',
	gemini: 'Gemini',
};

function getProviderDisplayName(provider: string): string {
	return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

/**
 * For a given provider, find its best model (highest or unlimited duration).
 * Returns { model, limitSeconds } where limitSeconds is null for unlimited.
 */
function getBestModelForProvider(provider: string): { model: string; limitSeconds: number | null } | null {
	const sttProvider = providerRegistry.getSTTProvider(provider);
	if (!sttProvider) return null;

	const models = sttProvider.getSupportedModels();
	if (models.length === 0) return null;

	// Use provider's getMaxDuration() which returns the limit for the provider
	const providerLimit = sttProvider.getMaxDuration();

	return { model: models[0]!.id, limitSeconds: providerLimit };
}

function findAlternatives(
	currentProvider: string,
	settings: MeetingScribeSettings,
): DurationGuardAlternative[] {
	const alternatives: DurationGuardAlternative[] = [];

	// Check all registered STT providers
	const knownProviders = Object.keys(PROVIDER_DISPLAY_NAMES);

	for (const provider of knownProviders) {
		if (provider === currentProvider) continue;

		// Check if this provider has credentials configured
		const testSettings = { ...settings, sttProvider: provider };
		if (!hasSTTCredentials(testSettings)) continue;

		const best = getBestModelForProvider(provider);
		if (!best) continue;

		if (best.limitSeconds === null) {
			// Unlimited — always a viable alternative
			alternatives.push({
				provider,
				model: best.model,
				displayName: getProviderDisplayName(provider),
				limitMinutes: null,
			});
		} else {
			alternatives.push({
				provider,
				model: best.model,
				displayName: getProviderDisplayName(provider),
				limitMinutes: Math.floor(best.limitSeconds / 60),
			});
		}
	}

	return alternatives;
}

export async function checkDurationGuard(
	audio: ArrayBuffer,
	settings: MeetingScribeSettings,
	app: App,
): Promise<DurationGuardResult> {
	const sttProvider = providerRegistry.getSTTProvider(settings.sttProvider);
	const maxDurationSeconds = sttProvider?.getMaxDuration() ?? null;

	// No limit for this provider — proceed
	if (maxDurationSeconds === null) {
		logger.debug(COMPONENT, 'No duration limit for provider', {
			provider: settings.sttProvider,
		});
		return { action: 'proceed' };
	}

	const durationSeconds = await estimateAudioDuration(audio);
	const durationMinutes = Math.ceil(durationSeconds / 60);
	const limitMinutes = Math.floor(maxDurationSeconds / 60);

	logger.debug(COMPONENT, 'Duration check', {
		durationSeconds,
		maxDurationSeconds,
		provider: settings.sttProvider,
		model: settings.sttModel,
	});

	// Within limit — proceed
	if (durationSeconds <= maxDurationSeconds) {
		return { action: 'proceed' };
	}

	// Exceeds limit — show modal
	const alternatives = findAlternatives(settings.sttProvider, settings);

	const modal = new DurationGuardModal(app, {
		durationMinutes,
		providerName: getProviderDisplayName(settings.sttProvider),
		limitMinutes,
		alternatives,
	});

	modal.open();
	const choice = await modal.getResult();

	logger.info(COMPONENT, 'User choice', { action: choice.action, switchProvider: choice.switchProvider });

	switch (choice.action) {
		case 'split':
			return { action: 'split', maxDurationSeconds };
		case 'switch': {
			if (!choice.switchProvider) return { action: 'cancel' };

			// Re-check duration against the new provider's limit
			const newProvider = providerRegistry.getSTTProvider(choice.switchProvider);
			const newLimit = newProvider?.getMaxDuration() ?? null;

			// If new provider has no limit or duration is within new limit, switch
			if (newLimit === null || durationSeconds <= newLimit) {
				return {
					action: 'switch',
					switchedProvider: choice.switchProvider,
					switchedModel: choice.switchModel,
				};
			}

			// New provider also can't handle it — recurse with updated settings
			logger.info(COMPONENT, 'Switched provider also exceeds limit, re-checking', {
				provider: choice.switchProvider,
				model: choice.switchModel,
				newLimit,
			});
			const updatedSettings = {
				...settings,
				sttProvider: choice.switchProvider,
				sttModel: choice.switchModel ?? settings.sttModel,
			};
			return checkDurationGuard(audio, updatedSettings, app);
		}
		case 'cancel':
		default:
			return { action: 'cancel' };
	}
}
