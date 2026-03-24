// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { TranscriptSidebarView } from '../../../src/ui/sidebar/transcript-sidebar-view';
import { SessionManager } from '../../../src/session/session-manager';
import type { MeetingSession } from '../../../src/session/types';
import type { PipelineState } from '../../../src/transcript/transcript-data';

function createMockSession(overrides: Partial<MeetingSession> = {}): MeetingSession {
	return {
		id: 'session-1',
		title: 'Meeting 2026-03-24 14:30',
		audioFile: 'audio/test.webm',
		transcriptFile: 'audio/test.webm.transcript.json',
		pipeline: {
			status: 'complete',
			progress: 100,
			completedSteps: ['transcribe', 'summarize', 'generate'],
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe('TranscriptSidebarView', () => {
	let leaf: WorkspaceLeaf;
	let sessionManager: SessionManager;
	let view: TranscriptSidebarView;
	let onRetry: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		leaf = new WorkspaceLeaf();
		sessionManager = new SessionManager();
		onRetry = vi.fn();
		view = new TranscriptSidebarView(leaf, sessionManager, onRetry);
	});

	describe('View identity', () => {
		it('returns correct VIEW_TYPE', () => {
			expect(TranscriptSidebarView.VIEW_TYPE).toBe('meeting-scribe-transcript');
			expect(view.getViewType()).toBe('meeting-scribe-transcript');
		});

		it('returns correct display text', () => {
			expect(view.getDisplayText()).toBe('Meeting Scribe');
		});

		it('returns correct icon', () => {
			expect(view.getIcon()).toBe('message-square');
		});
	});

	describe('onOpen / onClose lifecycle', () => {
		it('subscribes to SessionManager on open', async () => {
			const subscribeSpy = vi.spyOn(sessionManager, 'subscribe');
			await view.onOpen();
			expect(subscribeSpy).toHaveBeenCalledOnce();
		});

		it('unsubscribes from SessionManager on close', async () => {
			const unsubscribeSpy = vi.spyOn(sessionManager, 'unsubscribe');
			await view.onOpen();
			await view.onClose();
			expect(unsubscribeSpy).toHaveBeenCalledOnce();
		});

		it('renders session list on open', async () => {
			await view.onOpen();
			// With no sessions, should show empty state
			const empty = view.contentEl.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
			expect(empty!.textContent).toContain('No meeting sessions yet');
		});

		it('cleans up state on close', async () => {
			await view.onOpen();
			await view.onClose();
			// After close, internal state should be reset
			// Opening again should work cleanly
			await view.onOpen();
			const empty = view.contentEl.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
		});
	});

	describe('showSessionList()', () => {
		it('renders empty state when no sessions', async () => {
			await view.onOpen();
			const empty = view.contentEl.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
			expect(empty!.textContent).toBe('No meeting sessions yet. Start recording or import audio.');
		});

		it('renders session items when sessions exist', async () => {
			sessionManager.createSession('audio/meeting1.webm');
			sessionManager.createSession('audio/meeting2.webm');
			await view.onOpen();

			const items = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-session-item');
			expect(items.length).toBe(2);
		});

		it('renders complete sessions with clickable class', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();

			const item = view.contentEl.querySelector('.meeting-scribe-sidebar-session-item--clickable');
			expect(item).not.toBeNull();
		});

		it('renders error sessions with retry button', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'error',
				error: 'API timeout',
				failedStep: 'transcribe',
			});
			await view.onOpen();

			const retryBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-retry-btn');
			expect(retryBtn).not.toBeNull();
			expect(retryBtn!.textContent).toBe('Retry');
		});

		it('renders processing sessions with progress bar', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'transcribing',
				progress: 45,
			});
			await view.onOpen();

			const progressFill = view.contentEl.querySelector('.meeting-scribe-sidebar-progress-fill') as HTMLElement;
			expect(progressFill).not.toBeNull();
			expect(progressFill.style.width).toBe('45%');
		});
	});

	describe('showTranscript()', () => {
		it('renders transcript stub view with back button', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();

			view.showTranscript(session.id);

			const backBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-back-btn');
			expect(backBtn).not.toBeNull();
			expect(backBtn!.textContent).toBe('\u2190 Sessions');

			const stub = view.contentEl.querySelector('.meeting-scribe-sidebar-stub');
			expect(stub).not.toBeNull();
			expect(stub!.textContent).toContain('Story 12.2');
		});

		it('back button returns to session list', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();

			view.showTranscript(session.id);
			const backBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-back-btn') as HTMLElement;
			backBtn.click();

			// Should be back to session list
			const sessionItems = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-session-item');
			expect(sessionItems.length).toBe(1);
		});

		it('does nothing for non-existent session', async () => {
			await view.onOpen();
			view.showTranscript('non-existent');
			// Should still show session list (empty state)
			const empty = view.contentEl.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
		});
	});

	describe('Reactive updates via observer', () => {
		it('updates existing session item on state change', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			await view.onOpen();

			// Verify initial state (transcribing with 0%)
			let progressFill = view.contentEl.querySelector('.meeting-scribe-sidebar-progress-fill') as HTMLElement;
			expect(progressFill).not.toBeNull();

			// Update session state — observer will fire
			sessionManager.updateSessionState(session.id, {
				status: 'transcribing',
				progress: 75,
			});

			// Check that the DOM was updated
			progressFill = view.contentEl.querySelector('.meeting-scribe-sidebar-progress-fill') as HTMLElement;
			expect(progressFill).not.toBeNull();
			expect(progressFill.style.width).toBe('75%');
		});

		it('prepends new session to list', async () => {
			const session1 = sessionManager.createSession('audio/meeting1.webm');
			sessionManager.updateSessionState(session1.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();

			// Create a new session — observer should add it
			sessionManager.createSession('audio/meeting2.webm');

			const items = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-session-item');
			expect(items.length).toBe(2);
		});

		it('replaces empty state when first session is created', async () => {
			await view.onOpen();

			// Verify empty state
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-empty')).not.toBeNull();

			// Create a session
			sessionManager.createSession('audio/test.webm');

			// Empty state should be replaced with list
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-empty')).toBeNull();
			const items = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-session-item');
			expect(items.length).toBe(1);
		});

		it('does not update DOM when in transcript view', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();
			view.showTranscript(session.id);

			// Creating another session should not affect transcript view
			sessionManager.createSession('audio/test2.webm');

			// Should still show transcript stub, not session list
			const stub = view.contentEl.querySelector('.meeting-scribe-sidebar-stub');
			expect(stub).not.toBeNull();
		});
	});

	describe('Click handlers', () => {
		it('clicking completed session opens transcript view', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			await view.onOpen();

			const item = view.contentEl.querySelector('.meeting-scribe-sidebar-session-item--clickable') as HTMLElement;
			item.click();

			const stub = view.contentEl.querySelector('.meeting-scribe-sidebar-stub');
			expect(stub).not.toBeNull();
		});

		it('clicking retry button calls onRetry callback', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'error',
				error: 'Failed',
				failedStep: 'transcribe',
			});
			await view.onOpen();

			const retryBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-retry-btn') as HTMLElement;
			retryBtn.click();

			expect(onRetry).toHaveBeenCalledWith(session.id);
		});

		it('retry click does not propagate to session click', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'error',
				error: 'Failed',
				failedStep: 'transcribe',
			});
			await view.onOpen();

			const retryBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-retry-btn') as HTMLElement;
			retryBtn.click();

			// Should still be on session list (no navigation to transcript)
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-stub')).toBeNull();
		});
	});
});
