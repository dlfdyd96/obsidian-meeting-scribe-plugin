import { App, Notice } from 'obsidian';
import { ConfigError } from '../utils/errors';
import {
	NOTICE_SUCCESS_TIMEOUT_MS,
	NOTICE_RETRY_TIMEOUT_MS,
	NOTICE_PERSISTENT_TIMEOUT,
} from '../constants';

const STEP_DISPLAY_NAMES: Record<string, string> = {
	transcribing: 'Transcription',
	summarizing: 'Summarization',
	generating: 'Note generation',
};

function createClickableSpan(text: string, onClick: (e: MouseEvent) => void): HTMLSpanElement {
	const span = document.createElement('span');
	span.textContent = text;
	span.className = 'meeting-scribe-notice-link';
	span.style.cursor = 'pointer';
	span.style.textDecoration = 'underline';
	span.style.color = 'var(--interactive-accent)';
	span.addEventListener('click', (e: MouseEvent) => {
		e.stopPropagation();
		onClick(e);
	});
	return span;
}

export class NoticeManager {
	constructor(
		private readonly app: App,
		private readonly onRetry?: () => void,
		private readonly pluginId: string = 'meeting-scribe',
	) {}

	showSuccess(filePath: string): Notice {
		const fragment = document.createDocumentFragment();

		const msg = document.createElement('span');
		msg.textContent = '✓ Meeting note created — ';
		fragment.appendChild(msg);

		const link = createClickableSpan('click to open', () => {
			void (this.app as { workspace: { openLinkText: (link: string, sourcePath: string, newLeaf: boolean) => Promise<void> } }).workspace.openLinkText(filePath, '', true);
			notice.hide();
		});
		fragment.appendChild(link);

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
		safe.style.color = 'var(--text-muted)';
		safe.style.marginTop = '4px';
		fragment.appendChild(safe);

		if (this.onRetry) {
			const retryLink = createClickableSpan('Retry', () => {
				this.onRetry!();
				notice.hide();
			});
			retryLink.style.marginTop = '4px';
			retryLink.style.display = 'inline-block';
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
		safe.style.color = 'var(--text-muted)';
		safe.style.marginTop = '4px';
		fragment.appendChild(safe);

		const link = createClickableSpan('Open Settings', () => {
			const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
			setting.open();
			setting.openTabById(this.pluginId);
			notice.hide();
		});
		link.style.marginTop = '4px';
		link.style.display = 'inline-block';
		fragment.appendChild(link);

		const notice = new Notice(fragment, NOTICE_PERSISTENT_TIMEOUT);
		return notice;
	}

	showTestSuccess(): Notice {
		return new Notice('✓ Test complete — setup is working', NOTICE_SUCCESS_TIMEOUT_MS);
	}
}
