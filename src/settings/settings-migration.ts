import { DEFAULT_SETTINGS, CURRENT_SETTINGS_VERSION } from './settings';
import type { MeetingScribeSettings } from './settings';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

function migrateV0ToV1(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, DEFAULT_SETTINGS, data, { settingsVersion: 1 });
}

function migrateV1ToV2(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 2,
		includeTranscript: data['includeTranscript'] ?? true,
	});
}

function migrateV2ToV3(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 3,
		summaryLanguage: data['summaryLanguage'] ?? 'auto',
	});
}

function migrateV3ToV4(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 4,
		onboardingComplete: data['onboardingComplete'] ?? false,
	});
}

function migrateV4ToV5(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 5,
		enableSmartChunking: data['enableSmartChunking'] ?? false,
	});
}

function migrateV5ToV6(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 6,
		clovaInvokeUrl: data['clovaInvokeUrl'] ?? '',
		clovaSecretKey: data['clovaSecretKey'] ?? '',
		clovaLanguage: data['clovaLanguage'] ?? 'ko-KR',
		googleProjectId: data['googleProjectId'] ?? '',
		googleApiKey: data['googleApiKey'] ?? '',
		googleLocation: data['googleLocation'] ?? 'global',
		googleModel: data['googleModel'] ?? 'chirp_3',
		showConsentReminder: data['showConsentReminder'] ?? true,
	});
}

function migrateV6ToV7(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 7,
		separateTranscriptFile: data['separateTranscriptFile'] ?? false,
	});
}

function migrateV7ToV8(data: Record<string, unknown>): Record<string, unknown> {
	const result = Object.assign({}, data, { settingsVersion: 8 });
	delete result['clovaLanguage'];
	return result;
}

function migrateV8ToV9(data: Record<string, unknown>): Record<string, unknown> {
	const result = Object.assign({}, data, {
		settingsVersion: 9,
		geminiApiKey: data['geminiApiKey'] ?? data['googleApiKey'] ?? '',
	});
	if (result['sttProvider'] === 'google') {
		result['sttProvider'] = 'gemini';
		result['sttModel'] = 'gemini-2.5-flash';
	}
	delete result['googleProjectId'];
	delete result['googleLocation'];
	delete result['googleModel'];
	delete result['googleApiKey'];
	return result;
}

function migrateV9ToV10(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 10,
		autoOpenSidebar: data['autoOpenSidebar'] ?? true,
	});
}

function migrateV10ToV11(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, data, {
		settingsVersion: 11,
		enableSummary: data['enableSummary'] ?? true,
	});
}

const migrations: Migration[] = [
	migrateV0ToV1,
	migrateV1ToV2,
	migrateV2ToV3,
	migrateV3ToV4,
	migrateV4ToV5,
	migrateV5ToV6,
	migrateV6ToV7,
	migrateV7ToV8,
	migrateV8ToV9,
	migrateV9ToV10,
	migrateV10ToV11,
];

export function migrateSettings(data: unknown): MeetingScribeSettings {
	if (data == null || typeof data !== 'object') {
		return { ...DEFAULT_SETTINGS };
	}

	const record = data as Record<string, unknown>;
	const currentVersion = typeof record['settingsVersion'] === 'number'
		? record['settingsVersion']
		: 0;

	let result: Record<string, unknown> = { ...record };

	for (let i = currentVersion; i < CURRENT_SETTINGS_VERSION; i++) {
		const migration = migrations[i];
		if (migration) {
			result = migration(result);
		}
	}

	// Merge with defaults to fill any missing fields
	result = Object.assign({}, DEFAULT_SETTINGS, result);

	return result as unknown as MeetingScribeSettings;
}
