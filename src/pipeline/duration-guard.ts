import type { App } from 'obsidian';
import type { MeetingScribeSettings } from '../settings/settings';
import { hasSTTCredentials } from '../settings/settings';
import { getMaxDuration, PROVIDER_MAX_DURATION } from '../constants';
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
	google: 'Google Cloud STT',
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

	let bestModel = models[0]!.id;
	let bestLimit: number | null = null; // null = unlimited (best)
	let hasUnlimited = false;

	for (const m of models) {
		const limit = getMaxDuration(provider, m.id);
		if (limit === null) {
			// Unlimited model — this is the best choice
			hasUnlimited = true;
			bestModel = m.id;
			break;
		}
		if (bestLimit === null || limit > bestLimit) {
			bestLimit = limit;
			bestModel = m.id;
		}
	}

	return { model: bestModel, limitSeconds: hasUnlimited ? null : bestLimit };
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
	const maxDurationSeconds = getMaxDuration(settings.sttProvider, settings.sttModel);

	// No limit for this provider:model — proceed
	if (maxDurationSeconds === null) {
		logger.debug(COMPONENT, 'No duration limit for provider:model', {
			provider: settings.sttProvider,
			model: settings.sttModel,
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

			// AC #4: Re-check duration against the new provider's limit
			const newModel = choice.switchModel;
			const newLimit = newModel ? getMaxDuration(choice.switchProvider, newModel) : null;

			// If new provider has no limit or duration is within new limit, switch
			if (newLimit === null || durationSeconds <= newLimit) {
				return {
					action: 'switch',
					switchedProvider: choice.switchProvider,
					switchedModel: newModel,
				};
			}

			// New provider also can't handle it — recurse with updated settings
			logger.info(COMPONENT, 'Switched provider also exceeds limit, re-checking', {
				provider: choice.switchProvider,
				model: newModel,
				newLimit,
			});
			const updatedSettings = {
				...settings,
				sttProvider: choice.switchProvider,
				sttModel: newModel ?? settings.sttModel,
			};
			return checkDurationGuard(audio, updatedSettings, app);
		}
		case 'cancel':
		default:
			return { action: 'cancel' };
	}
}
