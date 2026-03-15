import { DEFAULT_SETTINGS, CURRENT_SETTINGS_VERSION } from './settings';
import type { MeetingScribeSettings } from './settings';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

function migrateV0ToV1(data: Record<string, unknown>): Record<string, unknown> {
	return Object.assign({}, DEFAULT_SETTINGS, data, { settingsVersion: 1 });
}

const migrations: Migration[] = [
	migrateV0ToV1,
	// Future: migrateV1ToV2, etc.
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

	// For future versions or already-current, merge with defaults to fill any missing fields
	if (currentVersion >= CURRENT_SETTINGS_VERSION) {
		result = Object.assign({}, DEFAULT_SETTINGS, result);
	}

	return result as unknown as MeetingScribeSettings;
}
