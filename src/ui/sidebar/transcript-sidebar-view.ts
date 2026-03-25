import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SessionManager } from '../../session/session-manager';
import { renderSessionList, renderSingleItem } from './session-list-renderer';
import { renderTranscriptView } from './chat-bubble-renderer';
import { AudioPlayerController } from './audio-player-controller';
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
	private audioPlayer: AudioPlayerController | null = null;
	private highlightedBubble: HTMLElement | null = null;
	private autoScrollEnabled = true;
	private programmaticScroll = false;
	private programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollPauseTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollContainer: HTMLElement | null = null;

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
		// Defensively unsubscribe stale observer from prior open cycle
		if (this.observer) {
			this.sessionManager.unsubscribe(this.observer);
			this.observer = null;
		}
		this.sessionElements.clear();
		this.contentEl.empty();

		this.observer = (sessionId: string, session: MeetingSession) => {
			this.onSessionUpdate(sessionId, session);
		};
		this.sessionManager.subscribe(this.observer);
		this.showSessionList();
		logger.debug(COMPONENT, 'Sidebar opened');
	}

	async onClose(): Promise<void> {
		this.destroyAudioPlayer();
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
		this.destroyAudioPlayer();
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
			() => this.showSessionList(),
		);
	}

	async showTranscript(sessionId: string): Promise<void> {
		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			logger.error(COMPONENT, 'Session not found', { sessionId });
			return;
		}

		this.destroyAudioPlayer();
		this.currentView = 'transcript';
		this.currentSessionId = sessionId;
		this.sessionElements.clear();
		this.contentEl.empty();

		// Flex column wrapper for header + scroll + player layout
		this.contentEl.classList.add('meeting-scribe-sidebar-transcript-layout');

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
		this.scrollContainer = this.contentEl.createDiv({ cls: 'meeting-scribe-sidebar-transcript-scroll' });
		renderTranscriptView(this.scrollContainer, data.segments, data.participants);

		// Scroll listener for manual scroll detection
		this.scrollContainer.addEventListener('scroll', () => this.handleManualScroll());

		// Timestamp click-to-seek via event delegation
		this.scrollContainer.addEventListener('click', (e) => this.handleTimestampClick(e));

		// Audio player at bottom
		if (session.audioFile) {
			this.audioPlayer = new AudioPlayerController((currentTime) => this.handleTimeUpdate(currentTime));
			const playerContainer = this.contentEl.createDiv();
			await this.audioPlayer.load(session.audioFile, this.app.vault);
			this.audioPlayer.render(playerContainer);
		}
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

	async showTranscriptForTranscriptFile(transcriptFilePath: string): Promise<void> {
		// Find session by transcript file path
		const sessions = this.sessionManager.getAllSessions();
		const session = sessions.find(s => s.transcriptFile === transcriptFilePath);
		if (!session) {
			logger.debug(COMPONENT, 'No session found for transcript file', { transcriptFilePath });
			return;
		}
		if (this.currentSessionId === session.id) {
			return;
		}
		await this.showTranscript(session.id);
	}

	private handleTimeUpdate(currentTime: number): void {
		if (!this.scrollContainer) return;

		const bubbles = Array.from(this.scrollContainer.querySelectorAll<HTMLElement>(
			'.meeting-scribe-sidebar-bubble[data-segment-start]',
		));

		let matchedBubble: HTMLElement | null = null;
		for (const bubble of bubbles) {
			const start = parseFloat(bubble.getAttribute('data-segment-start') ?? '');
			const end = parseFloat(bubble.getAttribute('data-segment-end') ?? '');
			if (!isNaN(start) && !isNaN(end) && start <= currentTime && currentTime < end) {
				matchedBubble = bubble;
				break;
			}
		}

		// Remove previous highlight
		if (this.highlightedBubble && this.highlightedBubble !== matchedBubble) {
			this.highlightedBubble.classList.remove('meeting-scribe-sidebar-bubble--active');
		}

		// Apply new highlight
		if (matchedBubble) {
			if (matchedBubble !== this.highlightedBubble) {
				matchedBubble.classList.add('meeting-scribe-sidebar-bubble--active');
				if (this.autoScrollEnabled) {
					this.programmaticScroll = true;
					if (this.programmaticScrollTimer !== null) {
						clearTimeout(this.programmaticScrollTimer);
					}
					matchedBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
					this.programmaticScrollTimer = setTimeout(() => {
						this.programmaticScroll = false;
						this.programmaticScrollTimer = null;
					}, 400);
				}
			}
		}

		this.highlightedBubble = matchedBubble;
	}

	private handleManualScroll(): void {
		if (this.programmaticScroll) {
			return;
		}

		this.autoScrollEnabled = false;
		if (this.scrollPauseTimer !== null) {
			clearTimeout(this.scrollPauseTimer);
		}
		this.scrollPauseTimer = setTimeout(() => {
			this.autoScrollEnabled = true;
			this.scrollPauseTimer = null;
		}, 3000);
	}

	private handleTimestampClick(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (!target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable')) return;

		const startTime = parseFloat(target.getAttribute('data-start') ?? '');
		if (isNaN(startTime) || !this.audioPlayer) return;

		this.audioPlayer.seekTo(startTime);
		this.audioPlayer.play();
	}

	toggleAudio(): void {
		this.audioPlayer?.toggle();
	}

	skipAudio(deltaSeconds: number): void {
		this.audioPlayer?.skip(deltaSeconds);
	}

	private destroyAudioPlayer(): void {
		if (this.audioPlayer) {
			this.audioPlayer.destroy();
			this.audioPlayer = null;
		}
		// Reset sync state
		this.highlightedBubble = null;
		this.autoScrollEnabled = true;
		this.programmaticScroll = false;
		if (this.programmaticScrollTimer !== null) {
			clearTimeout(this.programmaticScrollTimer);
			this.programmaticScrollTimer = null;
		}
		if (this.scrollPauseTimer !== null) {
			clearTimeout(this.scrollPauseTimer);
			this.scrollPauseTimer = null;
		}
		this.scrollContainer = null;
		this.contentEl.classList.remove('meeting-scribe-sidebar-transcript-layout');
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
