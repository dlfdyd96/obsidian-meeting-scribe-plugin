import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SessionManager } from '../../session/session-manager';
import { renderSessionList, renderSingleItem } from './session-list-renderer';
import { renderTranscriptView } from './chat-bubble-renderer';
import { AudioPlayerController } from './audio-player-controller';
import { loadTranscriptData, saveTranscriptData, generateSegmentId } from '../../transcript/transcript-data';
import type { TranscriptData } from '../../transcript/transcript-data';
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
	private transcriptData: TranscriptData | null = null;
	private transcriptFilePath: string | null = null;

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

		// Store transcript data for inline editing
		this.transcriptData = data;
		this.transcriptFilePath = session.transcriptFile;

		// Scrollable transcript container
		this.scrollContainer = this.contentEl.createDiv({ cls: 'meeting-scribe-sidebar-transcript-scroll' });
		renderTranscriptView(this.scrollContainer, data.segments, data.participants);

		// Scroll listener for manual scroll detection
		this.scrollContainer.addEventListener('scroll', () => this.handleManualScroll());

		// Event delegation for timestamp click-to-seek and inline editing
		this.scrollContainer.addEventListener('click', (e) => this.handleScrollContainerClick(e));
		this.scrollContainer.addEventListener('keydown', (e) => this.handleEditKeydown(e));
		this.scrollContainer.addEventListener('blur', (e) => this.handleEditBlur(e), true);

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

	private handleScrollContainerClick(e: MouseEvent): void {
		const target = e.target as HTMLElement;

		// Timestamp click-to-seek
		if (target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable')) {
			const startTime = parseFloat(target.getAttribute('data-start') ?? '');
			if (!isNaN(startTime) && this.audioPlayer) {
				this.audioPlayer.seekTo(startTime);
				this.audioPlayer.play();
			}
			return;
		}

		// Delete button click
		if (target.closest('.meeting-scribe-sidebar-bubble-delete-btn')) {
			const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
			if (bubble) this.handleDeleteSegment(bubble);
			return;
		}

		// Split button click
		if (target.closest('.meeting-scribe-sidebar-bubble-split-btn')) {
			const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
			if (bubble) this.handleSplitSegment(bubble);
			return;
		}

		// Bubble text click → enter edit mode
		if (target.classList.contains('meeting-scribe-sidebar-bubble-text')) {
			this.enterEditMode(target);
			return;
		}
	}

	private enterEditMode(textEl: HTMLElement): void {
		if (textEl.contentEditable === 'true') return; // Already editing

		const bubble = textEl.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
		if (!bubble) return;

		textEl.setAttribute('data-original-text', textEl.textContent ?? '');
		textEl.contentEditable = 'true';
		bubble.classList.add('meeting-scribe-sidebar-bubble--editing');
		textEl.focus();
	}

	private exitEditMode(textEl: HTMLElement): void {
		textEl.contentEditable = 'false';
		textEl.removeAttribute('data-original-text');
		const bubble = textEl.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
		bubble?.classList.remove('meeting-scribe-sidebar-bubble--editing');
	}

	private handleEditKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		const target = e.target as HTMLElement;
		if (!target.classList.contains('meeting-scribe-sidebar-bubble-text')) return;
		if (target.contentEditable !== 'true') return;

		// Restore original text and exit edit mode
		const originalText = target.getAttribute('data-original-text');
		if (originalText !== null) {
			target.textContent = originalText;
		}
		this.exitEditMode(target);
	}

	private async handleEditBlur(e: FocusEvent): Promise<void> {
		const target = e.target as HTMLElement;
		if (!target.classList.contains('meeting-scribe-sidebar-bubble-text')) return;
		if (target.contentEditable !== 'true') return;

		const originalText = target.getAttribute('data-original-text');
		const newText = target.textContent ?? '';

		this.exitEditMode(target);

		// Only save if text actually changed
		if (newText === originalText) return;
		if (!this.transcriptData || !this.transcriptFilePath) return;

		const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
		const segmentId = bubble?.getAttribute('data-segment-id');
		if (!segmentId) return;

		const segment = this.transcriptData.segments.find(s => s.id === segmentId);
		if (!segment) return;

		segment.text = newText;
		await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);
	}

	private async handleDeleteSegment(bubble: HTMLElement): Promise<void> {
		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		const segmentId = bubble.getAttribute('data-segment-id');
		if (!segmentId) return;

		if (!confirm('Delete this segment?')) return;

		const index = this.transcriptData.segments.findIndex(s => s.id === segmentId);
		if (index === -1) return;

		this.transcriptData.segments.splice(index, 1);
		await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);

		// Re-render transcript view
		while (this.scrollContainer.firstChild) this.scrollContainer.removeChild(this.scrollContainer.firstChild);
		renderTranscriptView(this.scrollContainer, this.transcriptData.segments, this.transcriptData.participants);
	}

	private async handleSplitSegment(bubble: HTMLElement): Promise<void> {
		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		const segmentId = bubble.getAttribute('data-segment-id');
		if (!segmentId) return;

		const index = this.transcriptData.segments.findIndex(s => s.id === segmentId);
		if (index === -1) return;

		const segment = this.transcriptData.segments[index]!;
		const text = segment.text;

		// Get cursor position
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const cursorOffset = selection.anchorOffset;

		// Don't split at start or end
		if (cursorOffset <= 0 || cursorOffset >= text.length) return;

		const text1 = text.substring(0, cursorOffset).trim();
		const text2 = text.substring(cursorOffset).trim();

		// After trimming, don't create empty segments
		if (!text1 || !text2) return;

		const timeSplit = segment.start + (cursorOffset / text.length) * (segment.end - segment.start);

		const seg1 = {
			id: generateSegmentId(),
			speaker: segment.speaker,
			start: segment.start,
			end: timeSplit,
			text: text1,
		};
		const seg2 = {
			id: generateSegmentId(),
			speaker: segment.speaker,
			start: timeSplit,
			end: segment.end,
			text: text2,
		};

		// Replace original with two new segments
		this.transcriptData.segments.splice(index, 1, seg1, seg2);
		await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);

		// Re-render
		while (this.scrollContainer.firstChild) this.scrollContainer.removeChild(this.scrollContainer.firstChild);
		renderTranscriptView(this.scrollContainer, this.transcriptData.segments, this.transcriptData.participants);
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
		this.transcriptData = null;
		this.transcriptFilePath = null;
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
