// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'obsidian'; // Import to trigger HTMLElement prototype patches (createDiv, createEl, etc.)
import { renderSessionList, renderSingleItem } from '../../../src/ui/sidebar/session-list-renderer';
import type { MeetingSession } from '../../../src/session/types';
import type { PipelineState } from '../../../src/transcript/transcript-data';

function createSession(overrides: Partial<MeetingSession & { pipeline: Partial<PipelineState> }> = {}): MeetingSession {
	const pipeline: PipelineState = {
		status: 'complete',
		progress: 100,
		completedSteps: ['transcribe', 'summarize', 'generate'],
		...(overrides.pipeline ?? {}),
	};
	return {
		id: 'test-session-1',
		title: 'Meeting 2026-03-24 14:30',
		audioFile: 'audio/test.webm',
		transcriptFile: 'audio/test.webm.transcript.json',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
		pipeline,
	};
}

describe('renderSessionList', () => {
	let container: HTMLElement;
	let elementMap: Map<string, HTMLElement>;
	let onSessionClick: ReturnType<typeof vi.fn>;
	let onRetry: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		container = document.createElement('div');
		elementMap = new Map();
		onSessionClick = vi.fn();
		onRetry = vi.fn();
	});

	describe('Empty state', () => {
		it('renders empty state message when no sessions', () => {
			renderSessionList(container, [], elementMap, onSessionClick, onRetry);

			const empty = container.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
			expect(empty!.textContent).toBe('No meeting sessions yet. Start recording or import audio.');
		});

		it('does not render list when no sessions', () => {
			renderSessionList(container, [], elementMap, onSessionClick, onRetry);

			const list = container.querySelector('.meeting-scribe-sidebar-session-list');
			expect(list).toBeNull();
		});
	});

	describe('Session list rendering', () => {
		it('renders session items in a list container', () => {
			const sessions = [createSession({ id: 's1' }), createSession({ id: 's2' })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const list = container.querySelector('.meeting-scribe-sidebar-session-list');
			expect(list).not.toBeNull();
			expect(list!.children.length).toBe(2);
		});

		it('populates element map with session IDs', () => {
			const sessions = [createSession({ id: 's1' }), createSession({ id: 's2' })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			expect(elementMap.size).toBe(2);
			expect(elementMap.has('s1')).toBe(true);
			expect(elementMap.has('s2')).toBe(true);
		});

		it('renders session title', () => {
			const sessions = [createSession({ title: 'Weekly Standup' })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const title = container.querySelector('.meeting-scribe-sidebar-session-title');
			expect(title).not.toBeNull();
			expect(title!.textContent).toBe('Weekly Standup');
		});

		it('stores session ID in data attribute', () => {
			const sessions = [createSession({ id: 'my-session' })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const item = container.querySelector('.meeting-scribe-sidebar-session-item') as HTMLElement;
			expect(item.dataset.sessionId).toBe('my-session');
		});
	});

	describe('Status dot rendering', () => {
		const statusTests: [PipelineState['status'], string][] = [
			['complete', 'complete'],
			['transcribing', 'processing'],
			['summarizing', 'processing'],
			['queued', 'queued'],
			['recording', 'recording'],
			['error', 'error'],
		];

		for (const [status, expectedCls] of statusTests) {
			it(`renders ${expectedCls} dot for ${status} status`, () => {
				const sessions = [createSession({ pipeline: { status, progress: 0, completedSteps: [] } })];
				renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

				const dot = container.querySelector(`.meeting-scribe-sidebar-status-dot--${expectedCls}`);
				expect(dot).not.toBeNull();
			});
		}

		it('sets aria-label on status dot', () => {
			const sessions = [createSession({ pipeline: { status: 'complete', progress: 100, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const dot = container.querySelector('.meeting-scribe-sidebar-status-dot');
			expect(dot!.getAttribute('aria-label')).toBe('Complete');
		});
	});

	describe('Progress bar', () => {
		it('renders progress bar for transcribing sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'transcribing', progress: 45, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const fill = container.querySelector('.meeting-scribe-sidebar-progress-fill') as HTMLElement;
			expect(fill).not.toBeNull();
			expect(fill.style.width).toBe('45%');
		});

		it('renders progress bar for summarizing sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'summarizing', progress: 80, completedSteps: ['transcribe'] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const fill = container.querySelector('.meeting-scribe-sidebar-progress-fill') as HTMLElement;
			expect(fill).not.toBeNull();
			expect(fill.style.width).toBe('80%');
		});

		it('does not render progress bar for complete sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'complete', progress: 100, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const fill = container.querySelector('.meeting-scribe-sidebar-progress-fill');
			expect(fill).toBeNull();
		});
	});

	describe('Retry button', () => {
		it('renders retry button for error sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'error', progress: 0, completedSteps: [], error: 'Fail', failedStep: 'transcribe' } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const retryBtn = container.querySelector('.meeting-scribe-sidebar-retry-btn');
			expect(retryBtn).not.toBeNull();
			expect(retryBtn!.textContent).toBe('Retry');
		});

		it('calls onRetry with session ID when retry is clicked', () => {
			const sessions = [createSession({ id: 'err-session', pipeline: { status: 'error', progress: 0, completedSteps: [], error: 'Fail' } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const retryBtn = container.querySelector('.meeting-scribe-sidebar-retry-btn') as HTMLElement;
			retryBtn.click();

			expect(onRetry).toHaveBeenCalledWith('err-session');
		});

		it('does not render retry button for non-error sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'complete', progress: 100, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			expect(container.querySelector('.meeting-scribe-sidebar-retry-btn')).toBeNull();
		});

		it('does not render retry button if onRetry is undefined', () => {
			const sessions = [createSession({ pipeline: { status: 'error', progress: 0, completedSteps: [], error: 'Fail' } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, undefined);

			expect(container.querySelector('.meeting-scribe-sidebar-retry-btn')).toBeNull();
		});
	});

	describe('Click handling', () => {
		it('calls onSessionClick for completed session click', () => {
			const sessions = [createSession({ id: 'done-session', pipeline: { status: 'complete', progress: 100, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const item = container.querySelector('.meeting-scribe-sidebar-session-item--clickable') as HTMLElement;
			item.click();

			expect(onSessionClick).toHaveBeenCalledWith('done-session');
		});

		it('does not add clickable class for non-complete sessions', () => {
			const sessions = [createSession({ pipeline: { status: 'transcribing', progress: 50, completedSteps: [] } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			expect(container.querySelector('.meeting-scribe-sidebar-session-item--clickable')).toBeNull();
		});

		it('retry click does not trigger session click', () => {
			const sessions = [createSession({ pipeline: { status: 'error', progress: 0, completedSteps: [], error: 'Fail' } })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const retryBtn = container.querySelector('.meeting-scribe-sidebar-retry-btn') as HTMLElement;
			retryBtn.click();

			expect(onSessionClick).not.toHaveBeenCalled();
		});
	});

	describe('renderSingleItem (static)', () => {
		it('renders a single session item', () => {
			const session = createSession({ id: 'single', title: 'Single Meeting' });
			const el = renderSingleItem(session, onSessionClick, onRetry);

			expect(el.classList.contains('meeting-scribe-sidebar-session-item')).toBe(true);
			expect(el.dataset.sessionId).toBe('single');
		});
	});

	describe('Date/time formatting', () => {
		it('shows time only for sessions created today', () => {
			const now = new Date();
			now.setHours(14, 30, 0, 0);
			const sessions = [createSession({ createdAt: now.toISOString() })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const meta = container.querySelector('.meeting-scribe-sidebar-session-meta');
			expect(meta!.textContent).toContain('14:30');
			// Should NOT contain a date
			expect(meta!.children[0]!.textContent).toBe('14:30');
		});

		it('shows full date for older sessions', () => {
			const oldDate = new Date('2025-01-15T10:00:00Z');
			const sessions = [createSession({ createdAt: oldDate.toISOString() })];
			renderSessionList(container, sessions, elementMap, onSessionClick, onRetry);

			const meta = container.querySelector('.meeting-scribe-sidebar-session-meta');
			expect(meta!.children[0]!.textContent).toContain('2025');
		});
	});
});
