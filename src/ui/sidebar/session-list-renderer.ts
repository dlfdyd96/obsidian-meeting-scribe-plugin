import type { MeetingSession } from '../../session/types';
import type { PipelineState } from '../../transcript/transcript-data';

type OnSessionClick = (sessionId: string) => void;
type OnRetry = ((sessionId: string) => void) | undefined;
type OnRefresh = (() => void) | undefined;

const REFRESH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';

const STATUS_CONFIG: Record<PipelineState['status'], { cls: string; label: string }> = {
	queued: { cls: 'queued', label: 'Queued' },
	recording: { cls: 'recording', label: 'Recording' },
	transcribing: { cls: 'processing', label: 'Transcribing' },
	summarizing: { cls: 'processing', label: 'Summarizing' },
	complete: { cls: 'complete', label: 'Complete' },
	error: { cls: 'error', label: 'Error' },
};

const PROCESSING_STATUSES: PipelineState['status'][] = ['transcribing', 'summarizing'];

export function renderSessionList(
	container: HTMLElement,
	sessions: MeetingSession[],
	elementMap: Map<string, HTMLElement>,
	onSessionClick: OnSessionClick,
	onRetry: OnRetry,
	onRefresh?: OnRefresh,
): void {
	// Header with title and refresh button
	const header = container.createDiv({ cls: 'meeting-scribe-sidebar-session-header' });
	header.createEl('span', { text: 'Sessions', cls: 'meeting-scribe-sidebar-session-header-title' });
	if (onRefresh) {
		const refreshBtn = header.createEl('button', {
			cls: 'meeting-scribe-sidebar-refresh-btn',
		});
		refreshBtn.innerHTML = REFRESH_SVG;
		refreshBtn.setAttribute('aria-label', 'Refresh sessions');
		refreshBtn.addEventListener('click', onRefresh);
	}

	if (sessions.length === 0) {
		container.createDiv({
			text: 'No meeting sessions yet. Start recording or import audio.',
			cls: 'meeting-scribe-sidebar-empty',
		});
		return;
	}

	const list = container.createDiv({ cls: 'meeting-scribe-sidebar-session-list' });
	for (const session of sessions) {
		const el = renderSingleItem(session, onSessionClick, onRetry);
		list.appendChild(el);
		elementMap.set(session.id, el);
	}
}

export function renderSingleItem(
	session: MeetingSession,
	onSessionClick: OnSessionClick,
	onRetry: OnRetry,
): HTMLElement {
	const config = STATUS_CONFIG[session.pipeline.status] ?? STATUS_CONFIG.error;
	const item = document.createElement('div');
	item.className = 'meeting-scribe-sidebar-session-item';
	item.dataset.sessionId = session.id;

	// Status dot
	const dot = item.createEl('span', {
		cls: `meeting-scribe-sidebar-status-dot meeting-scribe-sidebar-status-dot--${config.cls}`,
	});
	dot.setAttribute('aria-label', config.label);

	// Session info — display audio filename instead of generated title
	const info = item.createDiv({ cls: 'meeting-scribe-sidebar-session-info' });
	const rawFilename = session.audioFile.split('/').pop() ?? session.audioFile;
	const displayTitle = rawFilename.includes('.') ? rawFilename.split('.').slice(0, -1).join('.') : rawFilename;
	info.createEl('span', { text: displayTitle || session.title, cls: 'meeting-scribe-sidebar-session-title' });

	const meta = info.createDiv({ cls: 'meeting-scribe-sidebar-session-meta' });
	meta.createEl('span', { text: formatDateTime(session.createdAt) });
	meta.createEl('span', { text: config.label, cls: 'meeting-scribe-sidebar-session-status-text' });

	// Progress bar for processing sessions
	if (PROCESSING_STATUSES.includes(session.pipeline.status)) {
		const progress = info.createDiv({ cls: 'meeting-scribe-sidebar-progress' });
		const fill = progress.createDiv({ cls: 'meeting-scribe-sidebar-progress-fill' });
		fill.style.width = `${session.pipeline.progress}%`;
	}

	// Retry button for error sessions
	if (session.pipeline.status === 'error' && onRetry) {
		const retryBtn = item.createEl('button', {
			text: 'Retry',
			cls: 'meeting-scribe-sidebar-retry-btn',
		});
		retryBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			onRetry(session.id);
		});
	}

	// Click to open completed session transcript
	if (session.pipeline.status === 'complete') {
		item.classList.add('meeting-scribe-sidebar-session-item--clickable');
		item.addEventListener('click', () => onSessionClick(session.id));
	}

	return item;
}

function formatDateTime(isoString: string): string {
	const date = new Date(isoString);
	const now = new Date();
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const time = `${hours}:${minutes}`;

	// Same day
	if (
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate()
	) {
		return time;
	}

	// Same week (within 7 days)
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	if (diffDays < 7 && diffDays >= 0) {
		const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		return `${dayNames[date.getDay()]} ${time}`;
	}

	// Older
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d} ${time}`;
}

