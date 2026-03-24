import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SessionManager } from '../../session/session-manager';
import { renderSessionList, renderSingleItem } from './session-list-renderer';
import { renderTranscriptView } from './chat-bubble-renderer';
import { loadTranscriptData } from '../../transcript/transcript-data';
import { logger } from '../../utils/logger';
import type { MeetingSession, SessionObserver } from '../../session/types';

const COMPONENT = 'TranscriptSidebarView';

export class TranscriptSidebarView extends ItemView {
	static readonly VIEW_TYPE = 'meeting-scribe-transcript';

	private currentView: 'session-list' | 'transcript' = 'session-list';
	private currentSessionId: string | null = null;
	private observer: SessionObserver | null = null;
	private sessionElements: Map<string, HTMLElement> = new Map();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly sessionManager: SessionManager,
		private readonly onRetry?: (sessionId: string) => void,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TranscriptSidebarView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Meeting Scribe';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen(): Promise<void> {
		this.observer = (sessionId: string, session: MeetingSession) => {
			this.onSessionUpdate(sessionId, session);
		};
		this.sessionManager.subscribe(this.observer);
		this.showSessionList();
		logger.debug(COMPONENT, 'Sidebar opened');
	}

	async onClose(): Promise<void> {
		if (this.observer) {
			this.sessionManager.unsubscribe(this.observer);
			this.observer = null;
		}
		this.sessionElements.clear();
		this.currentSessionId = null;
		this.currentView = 'session-list';
		logger.debug(COMPONENT, 'Sidebar closed');
	}

	showSessionList(): void {
		this.currentView = 'session-list';
		this.currentSessionId = null;
		this.sessionElements.clear();
		this.contentEl.empty();

		const sessions = this.sessionManager.getAllSessions();
		renderSessionList(
			this.contentEl,
			sessions,
			this.sessionElements,
			(sessionId) => this.showTranscript(sessionId),
			this.onRetry,
		);
	}

	async showTranscript(sessionId: string): Promise<void> {
		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			logger.error(COMPONENT, 'Session not found', { sessionId });
			return;
		}

		this.currentView = 'transcript';
		this.currentSessionId = sessionId;
		this.sessionElements.clear();
		this.contentEl.empty();

		// Header: back button + title + action buttons
		const header = this.contentEl.createDiv({ cls: 'meeting-scribe-sidebar-transcript-header' });
		const backBtn = header.createEl('button', {
			text: '\u2190 Sessions',
			cls: 'meeting-scribe-sidebar-back-btn',
		});
		backBtn.addEventListener('click', () => this.showSessionList());

		header.createEl('h3', { text: session.title, cls: 'meeting-scribe-sidebar-session-title' });

		const actions = header.createDiv({ cls: 'meeting-scribe-sidebar-header-actions' });
		const resummarizeBtn = actions.createEl('button', {
			text: 'Re-summarize',
			cls: 'meeting-scribe-sidebar-action-btn',
		});
		resummarizeBtn.disabled = true;
		resummarizeBtn.setAttribute('aria-label', 'Re-summarize (coming soon)');

		const exportBtn = actions.createEl('button', {
			text: 'Export',
			cls: 'meeting-scribe-sidebar-action-btn',
		});
		exportBtn.disabled = true;
		exportBtn.setAttribute('aria-label', 'Export (coming soon)');

		// Load transcript data
		const data = await loadTranscriptData(this.app.vault, session.transcriptFile);
		if (!data) {
			this.contentEl.createDiv({
				text: 'Failed to load transcript data.',
				cls: 'meeting-scribe-sidebar-transcript-error',
			});
			logger.error(COMPONENT, 'Failed to load transcript', { sessionId, path: session.transcriptFile });
			return;
		}

		// Scrollable transcript container
		const scrollContainer = this.contentEl.createDiv({ cls: 'meeting-scribe-sidebar-transcript-scroll' });
		renderTranscriptView(scrollContainer, data.segments, data.participants);
	}

	async showTranscriptForNote(notePath: string): Promise<void> {
		const session = this.sessionManager.findSessionByNotePath(notePath);
		if (!session) {
			logger.debug(COMPONENT, 'No session found for note', { notePath });
			return;
		}
		if (this.currentSessionId === session.id) {
			return;
		}
		await this.showTranscript(session.id);
	}

	private onSessionUpdate(sessionId: string, session: MeetingSession): void {
		if (this.currentView !== 'session-list') return;

		const existingEl = this.sessionElements.get(sessionId);
		if (existingEl) {
			// Update existing element in place
			const newEl = renderSingleItem(
				session,
				(id) => this.showTranscript(id),
				this.onRetry,
			);
			existingEl.replaceWith(newEl);
			this.sessionElements.set(sessionId, newEl);
		} else {
			// New session — prepend to list
			const listContainer = this.contentEl.querySelector('.meeting-scribe-sidebar-session-list');
			const emptyState = this.contentEl.querySelector('.meeting-scribe-sidebar-empty');
			if (emptyState) {
				emptyState.remove();
				const list = this.contentEl.createDiv({ cls: 'meeting-scribe-sidebar-session-list' });
				const newEl = renderSingleItem(
					session,
					(id) => this.showTranscript(id),
					this.onRetry,
				);
				list.appendChild(newEl);
				this.sessionElements.set(sessionId, newEl);
			} else if (listContainer) {
				const newEl = renderSingleItem(
					session,
					(id) => this.showTranscript(id),
					this.onRetry,
				);
				listContainer.insertBefore(newEl, listContainer.firstChild);
				this.sessionElements.set(sessionId, newEl);
			}
		}
	}
}
