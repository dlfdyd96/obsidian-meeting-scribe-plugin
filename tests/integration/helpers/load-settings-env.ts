/**
 * Auto-load API credentials from plugin's data.json into process.env
 * for integration tests. Falls back gracefully if file doesn't exist.
 *
 * Priority: existing env vars > .env file > data.json
 * (This file is loaded as a Vitest setup file, runs before all tests)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../..');

// 1. Load .env file if it exists (simple key=value parsing)
const envFilePath = resolve(PROJECT_ROOT, '.env');
if (existsSync(envFilePath)) {
	const lines = readFileSync(envFilePath, 'utf-8').split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

// 2. Load from plugin data.json as fallback
const dataJsonPath = resolve(PROJECT_ROOT, 'data.json');
if (existsSync(dataJsonPath)) {
	try {
		const settings = JSON.parse(readFileSync(dataJsonPath, 'utf-8'));

		// Determine OpenAI key: could be in sttApiKey (if sttProvider=openai) or llmApiKey (if llmProvider=openai)
		const openaiKey = (settings.sttProvider === 'openai' ? settings.sttApiKey : null)
			|| (settings.llmProvider === 'openai' ? settings.llmApiKey : null);

		// Anthropic key: only if llmProvider is anthropic
		const anthropicKey = settings.llmProvider === 'anthropic' ? settings.llmApiKey : null;

		const mapping: Record<string, string | undefined> = {
			OPENAI_API_KEY: openaiKey || undefined,
			CLOVA_INVOKE_URL: settings.clovaInvokeUrl || undefined,
			CLOVA_SECRET_KEY: settings.clovaSecretKey || undefined,
			GOOGLE_PROJECT_ID: settings.googleProjectId || undefined,
			GOOGLE_API_KEY: settings.googleApiKey || undefined,
			GOOGLE_LOCATION: settings.googleLocation || undefined,
			ANTHROPIC_API_KEY: anthropicKey || undefined,
		};

		for (const [envKey, value] of Object.entries(mapping)) {
			if (value && !process.env[envKey]) {
				process.env[envKey] = value;
			}
		}
	} catch {
		// data.json parse failed, skip silently
	}
}
