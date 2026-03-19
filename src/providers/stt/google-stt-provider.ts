import { ConfigError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult } from '../types';

const COMPONENT = 'GoogleSTTProvider';

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'chirp_3', name: 'Chirp 3 (Recommended)', supportsDiarization: true },
	{ id: 'chirp_2', name: 'Chirp 2', supportsDiarization: true },
];

export class GoogleSTTProvider implements STTProvider {
	readonly name = 'google';

	private projectId = '';
	private apiKey = '';
	private location = 'global';

	setCredentials(projectId: string, apiKey: string, location: string): void {
		this.projectId = projectId;
		this.apiKey = apiKey;
		this.location = location;
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	async transcribe(_audio: ArrayBuffer, _options: STTOptions): Promise<TranscriptionResult> {
		throw new ConfigError('Google Cloud STT transcription not yet implemented — see Story 8.3');
	}

	async validateApiKey(key: string): Promise<boolean> {
		if (!this.projectId || !key) {
			return false;
		}

		logger.debug(COMPONENT, 'Validating Google Cloud STT credentials');

		try {
			const url = `https://speech.googleapis.com/v2/projects/${this.projectId}/locations/${this.location}/recognizers`;
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${key}`,
				},
			});

			if (response.status === 401 || response.status === 403) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}
}
