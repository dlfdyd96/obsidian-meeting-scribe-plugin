import { App, Notice } from 'obsidian';
import { ConfigError } from '../utils/errors';
import {
	NOTICE_CONSENT_TIMEOUT_MS,
	NOTICE_SUCCESS_TIMEOUT_MS,
	NOTICE_RETRY_TIMEOUT_MS,
	NOTICE_PERSISTENT_TIMEOUT,
	NOTICE_WELCOME_TIMEOUT_MS,
} from '../constants';

const STEP_DISPLAY_NAMES: Record<string, string> = {
	transcribing: 'Transcription',
	summarizing: 'Summarization',
	generating: 'Note generation',
};

function createClickableLink(text: string, onClick: (e: MouseEvent) => void): HTMLAnchorElement {
	const link = document.createElement('a');
	link.textContent = text;
	link.className = 'meeting-scribe-notice-link';
	link.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onClick(e);
	});
	return link;
}

export class NoticeManager {
	constructor(
		private readonly app: App,
		private readonly onRetry?: () => void,
		private readonly pluginId: string = 'meeting-scribe',
	) {}

	showSuccess(filePath: string, transcriptFilePath?: string): Notice {
		const fragment = document.createDocumentFragment();

		const msg = document.createElement('span');
		msg.textContent = '✓ Meeting note created — ';
		fragment.appendChild(msg);

		const link = createClickableLink('click to open', () => {
			void (this.app as { workspace: { openLinkText: (link: string, sourcePath: string, newLeaf: boolean) => Promise<void> } }).workspace.openLinkText(filePath, '', true);
			notice.hide();
		});
		fragment.appendChild(link);

		if (transcriptFilePath) {
			const transcriptInfo = document.createElement('div');
			const transcriptFilename = transcriptFilePath.split('/').pop() ?? transcriptFilePath;
			transcriptInfo.textContent = `📄 Transcript: ${transcriptFilename}`;
			transcriptInfo.className = 'meeting-scribe-notice-transcript';
			fragment.appendChild(transcriptInfo);
		}

		const notice = new Notice(fragment, NOTICE_SUCCESS_TIMEOUT_MS);
		return notice;
	}

	showRetry(attempt: number, maxAttempts: number): Notice {
		return new Notice(`Retrying... (${attempt}/${maxAttempts})`, NOTICE_RETRY_TIMEOUT_MS);
	}

	showError(stepName: string, error: Error): Notice {
		if (error instanceof ConfigError) {
			return this.showConfigError(error);
		}

		const fragment = document.createDocumentFragment();

		const displayName = STEP_DISPLAY_NAMES[stepName] ?? stepName;

		const msg = document.createElement('div');
		msg.textContent = `${displayName} failed — ${error.message}`;
		fragment.appendChild(msg);

		const safe = document.createElement('div');
		safe.textContent = 'Original audio is safe.';
		safe.className = 'meeting-scribe-notice-safe';
		fragment.appendChild(safe);

		if (this.onRetry) {
			const retryLink = createClickableLink('Retry', () => {
				this.onRetry!();
				notice.hide();
			});
			retryLink.classList.add('meeting-scribe-notice-action');
			fragment.appendChild(retryLink);
		}

		const notice = new Notice(fragment, NOTICE_PERSISTENT_TIMEOUT);
		return notice;
	}

	showConfigError(error: ConfigError): Notice {
		const fragment = document.createDocumentFragment();

		const msg = document.createElement('div');
		msg.textContent = error.message;
		fragment.appendChild(msg);

		const safe = document.createElement('div');
		safe.textContent = 'Original audio is safe.';
		safe.className = 'meeting-scribe-notice-safe';
		fragment.appendChild(safe);

		const link = createClickableLink('Open Settings', () => {
			const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
			setting.open();
			setting.openTabById(this.pluginId);
			notice.hide();
		});
		link.classList.add('meeting-scribe-notice-action');
		fragment.appendChild(link);

		const notice = new Notice(fragment, NOTICE_PERSISTENT_TIMEOUT);
		return notice;
	}

	showTestSuccess(): Notice {
		return new Notice('✓ Test complete — setup is working', NOTICE_SUCCESS_TIMEOUT_MS);
	}

	showWelcome(): Notice {
		return new Notice(
			'Welcome to Meeting Scribe! Set up your API keys to get started.',
			NOTICE_WELCOME_TIMEOUT_MS,
		);
	}

	showConsentReminder(): Notice {
		return new Notice(
			'Recording started. Please ensure all participants are aware of the recording.',
			NOTICE_CONSENT_TIMEOUT_MS,
		);
	}

	showRecordingUnavailable(): Notice {
		return new Notice(
			'Recording is not available on this device — you can import audio files instead',
			NOTICE_SUCCESS_TIMEOUT_MS,
		);
	}

	showMissingApiKeys(): Notice {
		const fragment = document.createDocumentFragment();

		const msg = document.createElement('div');
		msg.textContent = 'Set up API keys in settings to start recording';
		fragment.appendChild(msg);

		const link = createClickableLink('Open Settings', () => {
			const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
			setting.open();
			setting.openTabById(this.pluginId);
			notice.hide();
		});
		link.classList.add('meeting-scribe-notice-action');
		fragment.appendChild(link);

		const notice = new Notice(fragment, NOTICE_PERSISTENT_TIMEOUT);
		return notice;
	}
}
