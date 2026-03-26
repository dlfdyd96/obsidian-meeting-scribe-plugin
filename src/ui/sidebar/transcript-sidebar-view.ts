import { ItemView, Modal, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { SessionManager } from '../../session/session-manager';
import { renderSessionList, renderSingleItem } from './session-list-renderer';
import { renderTranscriptView } from './chat-bubble-renderer';
import { AudioPlayerController } from './audio-player-controller';
import { loadTranscriptData, saveTranscriptData, generateSegmentId } from '../../transcript/transcript-data';
import type { TranscriptData } from '../../transcript/transcript-data';
import {
	createSpeakerPopoverDOM,
	attachSpeakerPopoverBehavior,
	updateParticipantMapping,
} from './speaker-popover';
import { buildTranscriptionResultFromData } from './re-summarize-helpers';
import { SummarizeStep } from '../../pipeline/steps/summarize-step';
import { formatTranscriptSection } from '../../note/templates';
import { parseFrontmatter, applyParticipantReplacements } from '../../note/note-generator';
import { logger } from '../../utils/logger';
import type { MeetingSession, SessionObserver } from '../../session/types';
import type { MeetingScribeSettings } from '../../settings/settings';

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
	private activeSpeakerPopover: HTMLElement | null = null;
	private resummarizeBtn: HTMLButtonElement | null = null;
	private exportBtn: HTMLButtonElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly sessionManager: SessionManager,
		private readonly onRetry?: (sessionId: string) => void,
		private readonly getSettings?: () => MeetingScribeSettings,
		private readonly onRefreshSessions?: () => Promise<void>,
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
			(sessionId) => { void this.showTranscript(sessionId); },
			this.onRetry,
			() => { void this.handleRefresh(); },
			(sessionId) => { this.handleDeleteSession(sessionId); },
			(notePath) => !!this.app.vault.getAbstractFileByPath(notePath),
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
			text: '\u2190 sessions',
			cls: 'meeting-scribe-sidebar-back-btn',
		});
		backBtn.addEventListener('click', () => this.showSessionList());

		header.createEl('h3', { text: session.title, cls: 'meeting-scribe-sidebar-session-title' });

		const actions = header.createDiv({ cls: 'meeting-scribe-sidebar-header-actions' });
		this.resummarizeBtn = actions.createEl('button', {
			text: 'Re-summarize',
			cls: 'meeting-scribe-sidebar-action-btn',
		});
		this.resummarizeBtn.setAttribute('aria-label', 'Re-summarize transcript with LLM');
		this.resummarizeBtn.addEventListener('click', () => { this.handleResummarize(); });

		this.exportBtn = actions.createEl('button', {
			text: 'Export',
			cls: 'meeting-scribe-sidebar-action-btn',
		});
		this.exportBtn.setAttribute('aria-label', 'Export transcript to Markdown');
		this.exportBtn.addEventListener('click', () => { void this.handleExport(session.title); });

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
		this.scrollContainer.addEventListener('dblclick', (e) => this.handleTimestampDblClick(e));
		this.scrollContainer.addEventListener('keydown', (e) => this.handleEditKeydown(e));
		this.scrollContainer.addEventListener('blur', (e) => { void this.handleEditBlur(e); }, true);

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

		// Click inside active popover — let it handle internally
		if (this.activeSpeakerPopover?.contains(target)) {
			return;
		}

		// Click outside popover — close it
		if (this.activeSpeakerPopover && !target.classList.contains('meeting-scribe-sidebar-bubble-speaker')) {
			this.closeSpeakerPopover();
		}

		// Timestamp click-to-seek (single click) or edit (double click handled separately)
		if (target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable')) {
			if (target.contentEditable === 'true') return; // Already in edit mode
			const startTime = parseFloat(target.getAttribute('data-start') ?? '');
			if (!isNaN(startTime) && this.audioPlayer) {
				this.audioPlayer.seekTo(startTime);
				this.audioPlayer.play();
			}
			return;
		}

		// Delete button click
		if (target.closest('.meeting-scribe-sidebar-bubble-delete-btn')) {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
			const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
			if (bubble) this.handleDeleteSegment(bubble);
			return;
		}

		// Split button click
		if (target.closest('.meeting-scribe-sidebar-bubble-split-btn')) {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
			const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
			if (bubble) void this.handleSplitSegment(bubble);
			return;
		}

		// Speaker name click → open name mapping popover or reassign single segment
		if (target.classList.contains('meeting-scribe-sidebar-bubble-speaker')) {
			if (target.classList.contains('meeting-scribe-sidebar-bubble-speaker--reassign')) {
				this.openReassignPopover(target);
			} else {
				this.openSpeakerPopover(target);
			}
			return;
		}

		// Bubble text click → enter edit mode (use closest() for child elements from contentEditable)
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
		const textEl = target.closest('.meeting-scribe-sidebar-bubble-text') as HTMLElement | null;
		if (textEl) {
			this.enterEditMode(textEl);
			return;
		}
	}

	private enterEditMode(textEl: HTMLElement): void {
		if (textEl.contentEditable === 'true') return; // Already editing

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
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
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
		const bubble = textEl.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
		bubble?.classList.remove('meeting-scribe-sidebar-bubble--editing');
	}

	private handleTimestampDblClick(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (!target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable')) return;
		if (target.contentEditable === 'true') return;

		e.preventDefault();
		e.stopPropagation();

		target.setAttribute('data-original-text', target.textContent ?? '');
		target.contentEditable = 'true';
		target.classList.add('meeting-scribe-sidebar-bubble-timestamp--editing');
		target.focus();

		// Select all text for easy replacement
		const range = document.createRange();
		range.selectNodeContents(target);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	private handleEditKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		const target = e.target as HTMLElement;
		const isText = target.classList.contains('meeting-scribe-sidebar-bubble-text');
		const isTimestamp = target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable');
		if (!isText && !isTimestamp) return;
		if (target.contentEditable !== 'true') return;

		// Restore original text and exit edit mode
		const originalText = target.getAttribute('data-original-text');
		if (originalText !== null) {
			target.textContent = originalText;
		}
		if (isText) {
			this.exitEditMode(target);
		} else {
			target.contentEditable = 'false';
			target.removeAttribute('data-original-text');
			target.classList.remove('meeting-scribe-sidebar-bubble-timestamp--editing');
		}
	}

	private async handleEditBlur(e: FocusEvent): Promise<void> {
		const target = e.target as HTMLElement;
		const isText = target.classList.contains('meeting-scribe-sidebar-bubble-text');
		const isTimestamp = target.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable');
		if (!isText && !isTimestamp) return;
		if (target.contentEditable !== 'true') return;

		const originalText = target.getAttribute('data-original-text');
		const newText = target.textContent ?? '';

		if (isText) {
			this.exitEditMode(target);
		} else {
			target.contentEditable = 'false';
			target.removeAttribute('data-original-text');
			target.classList.remove('meeting-scribe-sidebar-bubble-timestamp--editing');
		}

		// Only save if text actually changed
		if (newText === originalText) return;
		if (!this.transcriptData || !this.transcriptFilePath) return;

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest() returns Element, need HTMLElement
		const bubble = target.closest('.meeting-scribe-sidebar-bubble') as HTMLElement | null;
		const segmentId = bubble?.getAttribute('data-segment-id');
		if (!segmentId) return;

		const segment = this.transcriptData.segments.find(s => s.id === segmentId);
		if (!segment) return;

		if (isText) {
			segment.text = newText;
			await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);
		} else {
			// Parse timestamp [HH:MM:SS] to seconds
			const parsed = this.parseTimestamp(newText);
			if (parsed !== null) {
				const duration = segment.end - segment.start;
				segment.start = parsed;
				segment.end = parsed + duration;

				// Re-sort segments by start time to maintain chronological order
				this.transcriptData.segments.sort((a, b) => a.start - b.start);

				await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);

				// Re-render to reflect new order
				if (this.scrollContainer) {
					while (this.scrollContainer.firstChild) this.scrollContainer.removeChild(this.scrollContainer.firstChild);
					renderTranscriptView(this.scrollContainer, this.transcriptData.segments, this.transcriptData.participants);
				}
			} else {
				// Invalid format — restore original
				target.textContent = originalText;
				return;
			}
		}
	}

	private parseTimestamp(text: string): number | null {
		// Parse [HH:MM:SS] or HH:MM:SS
		const clean = text.replace(/[[\]]/g, '').trim();
		const match = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
		if (!match || !match[1] || !match[2] || !match[3]) return null;
		return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
	}

	private handleDeleteSegment(bubble: HTMLElement): void {
		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		const segmentId = bubble.getAttribute('data-segment-id');
		if (!segmentId) return;

		const modal = new ConfirmModal(this.app, 'Delete this segment?', () => {
			if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

			const index = this.transcriptData.segments.findIndex(s => s.id === segmentId);
			if (index === -1) return;

			this.transcriptData.segments.splice(index, 1);
			void saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData).then(() => {
				if (!this.scrollContainer || !this.transcriptData) return;
				while (this.scrollContainer.firstChild) this.scrollContainer.removeChild(this.scrollContainer.firstChild);
				renderTranscriptView(this.scrollContainer, this.transcriptData.segments, this.transcriptData.participants);
			});
		});
		modal.open();
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

	private openSpeakerPopover(speakerEl: HTMLElement): void {
		// Close any existing popover
		this.closeSpeakerPopover();

		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		const alias = speakerEl.getAttribute('data-speaker-alias');
		if (!alias) return;

		const participant = this.transcriptData.participants.find(p => p.alias === alias);
		if (!participant) return;

		const currentName = participant.name || '';
		const currentWikiLink = participant.wikiLink;

		const popover = createSpeakerPopoverDOM(alias, currentName, currentWikiLink);
		popover.classList.add('meeting-scribe-sidebar-speaker-popover--visible');

		// Position relative to speaker element (account for scroll offset)
		const rect = speakerEl.getBoundingClientRect();
		const containerRect = this.scrollContainer.getBoundingClientRect();
		popover.setCssStyles({
			position: 'absolute',
			left: `${rect.left - containerRect.left}px`,
			top: `${rect.bottom - containerRect.top + this.scrollContainer.scrollTop + 4}px`,
		});

		attachSpeakerPopoverBehavior(popover, {
			onApply: (name, wikiLink) => {
				void this.applySpeakerMapping(alias, name, wikiLink).then(() => {
					this.closeSpeakerPopover();
				});
			},
			onCancel: () => {
				this.closeSpeakerPopover();
			},
			getVaultFiles: () => {
				return this.app.vault.getMarkdownFiles().map(f => ({
					basename: f.basename,
					path: f.path,
				}));
			},
		});

		this.scrollContainer.appendChild(popover);
		this.activeSpeakerPopover = popover;
	}

	private openReassignPopover(target: HTMLElement): void {
		this.closeSpeakerPopover();
		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		const segmentId = target.getAttribute('data-segment-id');
		if (!segmentId) return;

		const segment = this.transcriptData.segments.find(s => s.id === segmentId);
		if (!segment) return;

		// Build a simple dropdown of existing participants
		const popover = document.createElement('div');
		popover.className = 'meeting-scribe-sidebar-speaker-popover meeting-scribe-sidebar-speaker-popover--visible';

		const title = document.createElement('div');
		title.className = 'meeting-scribe-sidebar-speaker-popover-title';
		title.textContent = 'Reassign speaker';
		popover.appendChild(title);

		for (const p of this.transcriptData.participants) {
			if (p.alias === segment.speaker) continue; // Skip current speaker
			const opt = document.createElement('button');
			opt.className = 'meeting-scribe-sidebar-speaker-popover-suggestion';
			opt.textContent = p.name || p.alias;
			opt.setCssStyles({ display: 'block', width: '100%', textAlign: 'left' });
			opt.addEventListener('click', (e) => {
				e.stopPropagation();
				segment.speaker = p.alias;
				void saveTranscriptData(this.app.vault, this.transcriptFilePath!, this.transcriptData!).then(() => {
					this.closeSpeakerPopover();
					while (this.scrollContainer!.firstChild) this.scrollContainer!.removeChild(this.scrollContainer!.firstChild);
					renderTranscriptView(this.scrollContainer!, this.transcriptData!.segments, this.transcriptData!.participants);
				});
			});
			popover.appendChild(opt);
		}

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'meeting-scribe-sidebar-speaker-popover-cancel-btn';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.closeSpeakerPopover();
		});
		popover.appendChild(cancelBtn);

		// Position
		const rect = target.getBoundingClientRect();
		const containerRect = this.scrollContainer.getBoundingClientRect();
		popover.setCssStyles({
			position: 'absolute',
			left: `${rect.left - containerRect.left}px`,
			top: `${rect.bottom - containerRect.top + this.scrollContainer.scrollTop + 4}px`,
		});

		this.scrollContainer.appendChild(popover);
		this.activeSpeakerPopover = popover;
	}

	private closeSpeakerPopover(): void {
		if (this.activeSpeakerPopover) {
			this.activeSpeakerPopover.remove();
			this.activeSpeakerPopover = null;
		}
	}

	private async applySpeakerMapping(alias: string, name: string, wikiLink: boolean): Promise<void> {
		if (!this.transcriptData || !this.transcriptFilePath || !this.scrollContainer) return;

		updateParticipantMapping(this.transcriptData.participants, alias, name, wikiLink);
		await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);

		// Re-render transcript view
		while (this.scrollContainer.firstChild) this.scrollContainer.removeChild(this.scrollContainer.firstChild);
		renderTranscriptView(this.scrollContainer, this.transcriptData.segments, this.transcriptData.participants);
	}

	private handleResummarize(): void {
		if (!this.transcriptData || !this.transcriptFilePath) return;

		// Check pipeline is complete
		if (this.transcriptData.pipeline.status !== 'complete') {
			new Notice('Cannot re-summarize while pipeline is still running.');
			return;
		}

		// Check meeting note path exists (meetingNote or fallback to pipeline.noteFilePath)
		const notePath = this.transcriptData.meetingNote || this.transcriptData.pipeline.noteFilePath;
		if (!notePath) {
			new Notice('Meeting note not found. Try clicking the refresh button in the session list to resync.');
			return;
		}

		// Show confirmation modal
		const modal = new ConfirmModal(
			this.app,
			'This will send the edited transcript to LLM for a new summary. API cost will be incurred.',
			() => { void this.executeResummarize(); },
		);
		modal.open();
	}

	private async executeResummarize(): Promise<void> {
		if (!this.transcriptData || !this.transcriptFilePath || !this.resummarizeBtn) return;

		const settings = this.getSettings?.();
		if (!settings) {
			new Notice('Plugin settings not available.');
			return;
		}

		// Set loading state
		this.resummarizeBtn.disabled = true;
		this.resummarizeBtn.classList.add('meeting-scribe-sidebar-action-btn--loading');

		try {
			// Build TranscriptionResult from edited transcript
			const transcriptionResult = buildTranscriptionResultFromData(this.transcriptData);

			// Execute SummarizeStep
			const summarizeStep = new SummarizeStep();
			const context = await summarizeStep.execute({
				audioFilePath: this.transcriptData.audioFile,
				vault: this.app.vault,
				settings,
				transcriptionResult,
			});

			if (!context.summaryResult) {
				throw new Error('Summarization produced no result');
			}

			// Read existing note file
			const notePath = this.transcriptData.meetingNote || this.transcriptData.pipeline.noteFilePath;
			const noteFile = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
			if (!(noteFile instanceof TFile)) {
				new Notice('Meeting note file not found at the saved path. Try refreshing the session list.');
				return;
			}

			const oldContent = await this.app.vault.read(noteFile);
			const parsed = parseFrontmatter(oldContent);

			if (!parsed) {
				// No frontmatter — overwrite entire content
				await this.app.vault.modify(noteFile, context.summaryResult.summary);
			} else {
				// Extract audio embed from existing body
				const bodyLines = parsed.body.trim().split('\n');
				let audioEmbed = '';
				for (const line of bodyLines) {
					if (line.match(/^!?\[\[[^\]]+\]\]/)) {
						audioEmbed = line;
						break;
					}
				}

				// Build new content preserving frontmatter and audio embed
				let newBody = context.summaryResult.summary;

				// Apply participant name replacements
				const participants = this.transcriptData.participants
					.filter(p => p.name)
					.map(p => ({ alias: p.alias, name: p.name }));

				if (participants.length > 0) {
					const replacement = applyParticipantReplacements(
						`---\n${parsed.frontmatter}\n---\n\n${audioEmbed ? audioEmbed + '\n\n' : ''}${newBody}\n`,
						participants,
					);
					await this.app.vault.modify(noteFile, replacement.updatedContent);
				} else {
					const newContent = `---\n${parsed.frontmatter}\n---\n\n${audioEmbed ? audioEmbed + '\n\n' : ''}${newBody}\n`;
					await this.app.vault.modify(noteFile, newContent);
				}
			}

			// Update pipeline state
			if (!this.transcriptData.pipeline.completedSteps.includes('re-summarize')) {
				this.transcriptData.pipeline.completedSteps.push('re-summarize');
			}
			await saveTranscriptData(this.app.vault, this.transcriptFilePath, this.transcriptData);

			new Notice('Summary updated');
			logger.info(COMPONENT, 'Re-summarize completed', { notePath: this.transcriptData.meetingNote });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Re-summarize failed: ${message}`);
			logger.error(COMPONENT, 'Re-summarize failed', { error: message });
		} finally {
			// Reset button state
			if (this.resummarizeBtn) {
				this.resummarizeBtn.disabled = false;
				this.resummarizeBtn.classList.remove('meeting-scribe-sidebar-action-btn--loading');
			}
		}
	}

	private async handleExport(sessionTitle: string): Promise<void> {
		if (!this.transcriptData) return;

		try {
			// Build TranscriptionResult with mapped names + wiki-links for export
			const transcriptionResult = buildTranscriptionResultFromData(this.transcriptData, { applyWikiLinks: true });

			// Generate Markdown content
			const markdown = formatTranscriptSection(transcriptionResult);

			// Determine output path
			const sanitizedTitle = sessionTitle.split('').map(c => '/\\:*?"<>|'.includes(c) ? '-' : c).join('');
			const filename = `${sanitizedTitle} - Transcript.md`;
			const settings = this.getSettings?.();
			const folder = settings?.outputFolder || '';
			const basePath = folder ? `${folder}/${filename}` : filename;

			// Dedup path: append counter if file exists
			let outputPath = basePath;
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(outputPath)) {
				const name = `${sanitizedTitle} - Transcript ${counter}.md`;
				outputPath = folder ? `${folder}/${name}` : name;
				counter++;
			}

			// Ensure folder exists
			if (folder) {
				const folderExists = await this.app.vault.adapter.exists(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}

			await this.app.vault.create(outputPath, markdown);
			new Notice(`Transcript exported to ${outputPath}`);
			logger.info(COMPONENT, 'Transcript exported', { outputPath });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Export failed: ${message}`);
			logger.error(COMPONENT, 'Export failed', { error: message });
		}
	}

	private destroyAudioPlayer(): void {
		this.closeSpeakerPopover();
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
		this.resummarizeBtn = null;
		this.exportBtn = null;
		this.contentEl.classList.remove('meeting-scribe-sidebar-transcript-layout');
	}

	private handleDeleteSession(sessionId: string): void {
		const modal = new ConfirmModal(this.app, 'Delete this session and its transcript data?', () => {
			const session = this.sessionManager.getSession(sessionId);
			if (session) {
				// Delete transcript JSON file
				const transcriptFile = this.app.vault.getAbstractFileByPath(session.transcriptFile);
				if (transcriptFile instanceof TFile) {
					void this.app.fileManager.trashFile(transcriptFile);
				}
			}
			this.sessionManager.removeSession(sessionId);
			this.showSessionList();
		});
		modal.open();
	}

	private async handleRefresh(): Promise<void> {
		if (this.onRefreshSessions) {
			await this.onRefreshSessions();
		}
		this.showSessionList();
	}

	private onSessionUpdate(sessionId: string, session: MeetingSession): void {
		if (this.currentView !== 'session-list') return;

		const existingEl = this.sessionElements.get(sessionId);
		if (existingEl) {
			// Update existing element in place
			const newEl = renderSingleItem(
				session,
				(id) => { void this.showTranscript(id); },
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
					(id) => { void this.showTranscript(id); },
					this.onRetry,
				);
				list.appendChild(newEl);
				this.sessionElements.set(sessionId, newEl);
			} else if (listContainer) {
				const newEl = renderSingleItem(
					session,
					(id) => { void this.showTranscript(id); },
					this.onRetry,
				);
				listContainer.insertBefore(newEl, listContainer.firstChild);
				this.sessionElements.set(sessionId, newEl);
			}
		}
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: import('obsidian').App,
		private readonly message: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: this.message });
		const btnRow = contentEl.createDiv({ cls: 'meeting-scribe-modal-actions' });
		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		const confirmBtn = btnRow.createEl('button', { text: 'Confirm', cls: 'mod-warning' });
		cancelBtn.addEventListener('click', () => this.close());
		confirmBtn.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
