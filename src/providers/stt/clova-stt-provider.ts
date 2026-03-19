import { ConfigError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { STTProvider, STTOptions, STTModel, TranscriptionResult } from '../types';

const COMPONENT = 'ClovaSpeechSTTProvider';

const SUPPORTED_MODELS: STTModel[] = [
	{ id: 'clova-sync', name: 'CLOVA Speech (Sync)', supportsDiarization: true },
];

export class ClovaSpeechSTTProvider implements STTProvider {
	readonly name = 'clova';

	private invokeUrl = '';
	private secretKey = '';

	setCredentials(invokeUrl: string, secretKey: string): void {
		this.invokeUrl = invokeUrl;
		this.secretKey = secretKey;
	}

	getSupportedModels(): STTModel[] {
		return [...SUPPORTED_MODELS];
	}

	async transcribe(_audio: ArrayBuffer, _options: STTOptions): Promise<TranscriptionResult> {
		throw new ConfigError('CLOVA Speech transcription not yet implemented — see Story 8.2');
	}

	async validateApiKey(key: string): Promise<boolean> {
		if (!this.invokeUrl || !key) {
			return false;
		}

		logger.debug(COMPONENT, 'Validating CLOVA Speech credentials');

		try {
			// eslint-disable-next-line no-restricted-globals -- fetch required for error body access per architecture decision
			const response = await fetch(`${this.invokeUrl}/recognizer/upload`, {
				method: 'POST',
				headers: {
					'X-CLOVASPEECH-API-KEY': key,
				},
				body: new FormData(),
			});

			// 401/403 means invalid credentials; any other response means credentials work
			if (response.status === 401 || response.status === 403) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}
}
