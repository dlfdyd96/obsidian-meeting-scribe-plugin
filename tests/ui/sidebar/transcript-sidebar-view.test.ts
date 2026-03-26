// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { TranscriptSidebarView } from '../../../src/ui/sidebar/transcript-sidebar-view';
import { SessionManager } from '../../../src/session/session-manager';
import type { MeetingSession } from '../../../src/session/types';
import type { PipelineState, TranscriptData } from '../../../src/transcript/transcript-data';

vi.mock('../../../src/transcript/transcript-data', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/transcript/transcript-data')>();
	return {
		...actual,
		loadTranscriptData: vi.fn().mockResolvedValue(null),
		saveTranscriptData: vi.fn().mockResolvedValue(undefined),
	};
});

import { loadTranscriptData, saveTranscriptData } from '../../../src/transcript/transcript-data';
const mockLoadTranscriptData = vi.mocked(loadTranscriptData);
const mockSaveTranscriptData = vi.mocked(saveTranscriptData);

function createMockTranscriptData(): TranscriptData {
	return {
		version: 2,
		audioFile: 'audio/test.webm',
		duration: 120,
		provider: 'openai',
		model: 'whisper-1',
		language: 'en',
		segments: [
			{ id: 'seg-1', speaker: 'Participant 1', start: 0, end: 10, text: 'Hello there.' },
			{ id: 'seg-2', speaker: 'Participant 2', start: 10, end: 20, text: 'Hi, how are you?' },
			{ id: 'seg-3', speaker: 'Participant 1', start: 20, end: 30, text: 'Doing well.' },
		],
		participants: [
			{ alias: 'Participant 1', name: '', wikiLink: false, color: 0 },
			{ alias: 'Participant 2', name: '', wikiLink: false, color: 1 },
		],
		pipeline: { status: 'complete', progress: 100, completedSteps: ['transcribe', 'summarize', 'generate'] },
		meetingNote: 'notes/meeting.md',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

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

// Store originals for URL mock
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const OriginalAudio = globalThis.Audio;

describe('TranscriptSidebarView', () => {
	let leaf: WorkspaceLeaf;
	let sessionManager: SessionManager;
	let view: TranscriptSidebarView;
	let onRetry: ReturnType<typeof vi.fn>;
	let mockAudioInstance: { src: string; paused: boolean; currentTime: number; duration: number; playbackRate: number; volume: number; preload: string; play: () => Promise<void>; pause: () => void; addEventListener: () => void; removeEventListener: () => void };
	let revokedUrls: string[];

	beforeEach(() => {
		leaf = new WorkspaceLeaf();
		sessionManager = new SessionManager();
		onRetry = vi.fn();
		view = new TranscriptSidebarView(leaf, sessionManager, onRetry);

		// Mock Audio/URL for AudioPlayerController integration
		revokedUrls = [];
		mockAudioInstance = {
			src: '', paused: true, currentTime: 0, duration: 100,
			playbackRate: 1, volume: 1, preload: '',
			play: vi.fn().mockResolvedValue(undefined),
			pause: vi.fn(() => { mockAudioInstance.paused = true; }),
			addEventListener: vi.fn(), removeEventListener: vi.fn(),
		};
		globalThis.Audio = vi.fn(() => mockAudioInstance) as unknown as typeof Audio;
		URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		URL.revokeObjectURL = vi.fn((url: string) => { revokedUrls.push(url); });
	});

	afterEach(() => {
		globalThis.Audio = OriginalAudio;
		URL.createObjectURL = originalCreateObjectURL;
		URL.revokeObjectURL = originalRevokeObjectURL;
	});

	describe('View identity', () => {
		it('returns correct VIEW_TYPE', () => {
			expect(TranscriptSidebarView.VIEW_TYPE).toBe('meeting-scribe-transcript');
			expect(view.getViewType()).toBe('meeting-scribe-transcript');
		});

		it('returns correct display text', () => {
			expect(view.getDisplayText()).toBe('Transcript');
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
		it('renders transcript view with back button and action buttons', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);

			const backBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-back-btn');
			expect(backBtn).not.toBeNull();
			expect(backBtn!.textContent).toBe('\u2190 sessions');

			// Header should have session title
			const title = view.contentEl.querySelector('.meeting-scribe-sidebar-session-title');
			expect(title).not.toBeNull();

			// Action buttons should be enabled (Re-summarize + Export)
			const actionBtns = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-action-btn');
			expect(actionBtns.length).toBe(2);
			expect((actionBtns[0] as HTMLButtonElement).disabled).toBe(false);
			expect((actionBtns[1] as HTMLButtonElement).disabled).toBe(false);
		});

		it('renders chat bubbles from transcript data', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles.length).toBe(3);

			const scrollContainer = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-scroll');
			expect(scrollContainer).not.toBeNull();
		});

		it('shows error when transcript data fails to load', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			mockLoadTranscriptData.mockResolvedValueOnce(null);
			await view.onOpen();

			await view.showTranscript(session.id);

			const errorEl = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-error');
			expect(errorEl).not.toBeNull();
			expect(errorEl!.textContent).toContain('Failed to load transcript');
		});

		it('back button returns to session list', async () => {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);
			const backBtn = view.contentEl.querySelector('.meeting-scribe-sidebar-back-btn') as HTMLElement;
			backBtn.click();

			// Should be back to session list
			const sessionItems = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-session-item');
			expect(sessionItems.length).toBe(1);
		});

		it('does nothing for non-existent session', async () => {
			await view.onOpen();
			await view.showTranscript('non-existent');
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
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();
			await view.showTranscript(session.id);

			// Creating another session should not affect transcript view
			sessionManager.createSession('audio/test2.webm');

			// Should still show transcript view header, not session list
			const header = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-header');
			expect(header).not.toBeNull();
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
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			const item = view.contentEl.querySelector('.meeting-scribe-sidebar-session-item--clickable') as HTMLElement;
			item.click();
			// Wait for async showTranscript to complete
			await vi.waitFor(() => {
				expect(view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-header')).not.toBeNull();
			});
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
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-header')).toBeNull();
		});
	});

	describe('showTranscriptForNote', () => {
		it('switches to transcript view when session found by noteFilePath', async () => {
			const session = createMockSession({
				id: 'session-note',
				pipeline: {
					status: 'complete',
					progress: 100,
					completedSteps: ['transcribe', 'summarize', 'generate'],
					noteFilePath: 'Meeting Notes/My Meeting.md',
				},
			});
			vi.spyOn(sessionManager, 'findSessionByNotePath').mockReturnValue(session);
			vi.spyOn(sessionManager, 'getSession').mockReturnValue(session);
			mockLoadTranscriptData.mockResolvedValue(createMockTranscriptData());

			await view.onOpen();
			await view.showTranscriptForNote('Meeting Notes/My Meeting.md');

			// Should be in transcript view
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-header')).not.toBeNull();
		});

		it('does nothing when session not found', async () => {
			vi.spyOn(sessionManager, 'findSessionByNotePath').mockReturnValue(undefined);
			await view.onOpen();

			await view.showTranscriptForNote('Meeting Notes/nonexistent.md');

			// Should remain on session list
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-header')).toBeNull();
		});

		it('does nothing when already showing that session', async () => {
			const session = createMockSession({
				id: 'session-already',
				pipeline: {
					status: 'complete',
					progress: 100,
					completedSteps: ['transcribe', 'summarize', 'generate'],
					noteFilePath: 'Meeting Notes/Already.md',
				},
			});
			vi.spyOn(sessionManager, 'findSessionByNotePath').mockReturnValue(session);
			vi.spyOn(sessionManager, 'getSession').mockReturnValue(session);
			mockLoadTranscriptData.mockResolvedValue(createMockTranscriptData());

			await view.onOpen();
			await view.showTranscript('session-already');

			const showTranscriptSpy = vi.spyOn(view, 'showTranscript');
			await view.showTranscriptForNote('Meeting Notes/Already.md');

			// showTranscript should not be called again
			expect(showTranscriptSpy).not.toHaveBeenCalled();
		});
	});

	describe('Audio player lifecycle (integration)', () => {
		function createCompleteSession(): MeetingSession {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			return sessionManager.getSession(session.id)!;
		}

		it('creates audio player when showing transcript with audioFile', async () => {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);

			const player = view.contentEl.querySelector('.meeting-scribe-sidebar-player');
			expect(player).not.toBeNull();
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-player-play-btn')).not.toBeNull();
		});

		it('adds flex layout class to contentEl in transcript view', async () => {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);

			expect(view.contentEl.classList.contains('meeting-scribe-sidebar-transcript-layout')).toBe(true);
		});

		it('destroys audio player and removes layout class when returning to session list', async () => {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-player')).not.toBeNull();

			view.showSessionList();

			// Player should be gone, layout class removed
			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-player')).toBeNull();
			expect(view.contentEl.classList.contains('meeting-scribe-sidebar-transcript-layout')).toBe(false);
		});

		it('revokes ObjectURL when switching sessions', async () => {
			const session1 = createCompleteSession();
			const session2 = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValue(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session1.id);
			await view.showTranscript(session2.id);

			// First player's ObjectURL should have been revoked
			expect(revokedUrls).toContain('blob:mock-url');
		});

		it('destroys audio player on view close', async () => {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);
			await view.onClose();

			expect(revokedUrls).toContain('blob:mock-url');
		});

		it('does not render audio player when session has no audioFile', async () => {
			const session = createCompleteSession();
			// Override session to have no audioFile
			const noAudioSession = createMockSession({ id: session.id, audioFile: undefined });
			vi.spyOn(sessionManager, 'getSession').mockReturnValue(noAudioSession);
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();

			await view.showTranscript(session.id);

			expect(view.contentEl.querySelector('.meeting-scribe-sidebar-player')).toBeNull();
		});
	});

	describe('Playback-transcript synchronization', () => {
		// Mock scrollIntoView since JSDOM does not implement it
		const scrollIntoViewMock = vi.fn();

		function createCompleteSession(): MeetingSession {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			return sessionManager.getSession(session.id)!;
		}

		beforeEach(() => {
			HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
			scrollIntoViewMock.mockClear();
		});

		async function setupTranscriptView(): Promise<{ session: MeetingSession; fireTimeUpdate: (time: number) => void }> {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();
			await view.showTranscript(session.id);

			// Extract the onTimeUpdate callback from AudioPlayerController construction
			const AudioPlayerCtor = globalThis.Audio as unknown as ReturnType<typeof vi.fn>;
			// The AudioPlayerController was created with a callback. We need to
			// simulate timeupdate by accessing the private handleTimeUpdate method.
			// Instead, we'll fire timeupdate events through the mock audio.
			const audioAddEventListener = mockAudioInstance.addEventListener as ReturnType<typeof vi.fn>;
			const timeupdateHandler = audioAddEventListener.mock.calls.find(
				(call: unknown[]) => call[0] === 'timeupdate'
			)?.[1] as (() => void) | undefined;

			const fireTimeUpdate = (time: number): void => {
				mockAudioInstance.currentTime = time;
				if (timeupdateHandler) timeupdateHandler();
			};

			return { session, fireTimeUpdate };
		}

		it('highlights the correct bubble when playback time matches segment range', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			// Segment 1: start=0, end=10
			fireTimeUpdate(5);

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
		});

		it('moves highlight when playback advances to next segment', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(5); // In segment 1 (0-10)
			fireTimeUpdate(15); // In segment 2 (10-20)

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
		});

		it('removes highlight when no segment matches (gap)', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(5); // In segment 1
			fireTimeUpdate(35); // Beyond all segments (end at 30)

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
			expect(bubbles[2]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
		});

		it('highlights segment at exact start boundary (start <= currentTime)', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(10); // Exactly at segment 2 start

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
		});

		it('does not highlight at exact end boundary (currentTime < end)', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			// Segment 1: end=10, Segment 2: start=10
			// At time=10, segment 2 should be highlighted (10 <= 10 < 20), not segment 1 (0 <= 10 < 10 is false)
			fireTimeUpdate(10);

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
		});

		it('auto-scrolls highlighted bubble into view', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(5);

			expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
		});

		it('does not scroll when same bubble remains highlighted', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(5);
			scrollIntoViewMock.mockClear();
			fireTimeUpdate(7); // Still in segment 1

			expect(scrollIntoViewMock).not.toHaveBeenCalled();
		});

		it('pauses auto-scroll on manual scroll and resumes after 3 seconds', async () => {
			vi.useFakeTimers();
			const { fireTimeUpdate } = await setupTranscriptView();

			const scrollContainer = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-scroll')!;

			// Simulate manual scroll
			scrollContainer.dispatchEvent(new Event('scroll'));

			// Now fire timeupdate — should highlight but NOT scroll
			scrollIntoViewMock.mockClear();
			fireTimeUpdate(15); // Move to segment 2

			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[1]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
			expect(scrollIntoViewMock).not.toHaveBeenCalled();

			// Advance 3 seconds — auto-scroll should resume
			vi.advanceTimersByTime(3000);
			scrollIntoViewMock.mockClear();
			fireTimeUpdate(25); // Move to segment 3

			expect(bubbles[2]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
			expect(scrollIntoViewMock).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('suppresses multiple scroll events during programmatic scroll window (400ms)', async () => {
			vi.useFakeTimers();
			const { fireTimeUpdate } = await setupTranscriptView();

			const scrollContainer = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-scroll')!;

			// Trigger programmatic scroll by moving to segment 2
			fireTimeUpdate(15);
			scrollIntoViewMock.mockClear();

			// Simulate multiple scroll events from smooth animation (within 400ms)
			scrollContainer.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(100);
			scrollContainer.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(100);
			scrollContainer.dispatchEvent(new Event('scroll'));

			// After 400ms total, programmaticScroll flag should expire
			vi.advanceTimersByTime(200);

			// Move to segment 3 — auto-scroll should still work (not paused by programmatic scroll events)
			fireTimeUpdate(25);
			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[2]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);
			expect(scrollIntoViewMock).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('resets scroll pause timer on rapid manual scrolls', async () => {
			vi.useFakeTimers();
			const { fireTimeUpdate } = await setupTranscriptView();

			const scrollContainer = view.contentEl.querySelector('.meeting-scribe-sidebar-transcript-scroll')!;

			// First scroll
			scrollContainer.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(2000);

			// Second scroll before 3s — should reset timer
			scrollContainer.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(2000);

			// Only 2s since last scroll — should still be paused
			scrollIntoViewMock.mockClear();
			fireTimeUpdate(15);
			expect(scrollIntoViewMock).not.toHaveBeenCalled();

			// Advance remaining 1s — should now resume
			vi.advanceTimersByTime(1000);
			scrollIntoViewMock.mockClear();
			fireTimeUpdate(25);
			expect(scrollIntoViewMock).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('timestamp click seeks audio player and starts playback', async () => {
			await setupTranscriptView();

			const timestamps = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble-timestamp--clickable');
			const secondTimestamp = timestamps[1] as HTMLElement;

			secondTimestamp.click();

			// Audio should seek to segment 2 start (10s) and play
			expect(mockAudioInstance.currentTime).toBe(10);
			expect(mockAudioInstance.play).toHaveBeenCalled();
		});

		it('timestamp click does nothing when no audio player', async () => {
			const session = createCompleteSession();
			const noAudioSession = createMockSession({ id: session.id, audioFile: undefined });
			vi.spyOn(sessionManager, 'getSession').mockReturnValue(noAudioSession);
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			await view.onOpen();
			await view.showTranscript(session.id);

			const timestamps = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble-timestamp--clickable');
			// Should not crash
			(timestamps[0] as HTMLElement).click();
			expect(mockAudioInstance.play).not.toHaveBeenCalled();
		});

		it('toggleAudio() delegates to audioPlayer.toggle()', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			// Verify audioPlayer exists by checking player element
			const player = view.contentEl.querySelector('.meeting-scribe-sidebar-player');
			expect(player).not.toBeNull();

			// Call toggleAudio — should call play on paused audio
			view.toggleAudio();
			expect(mockAudioInstance.play).toHaveBeenCalled();
		});

		it('toggleAudio() is no-op when audioPlayer is null', async () => {
			await view.onOpen();
			// No transcript loaded, so audioPlayer is null
			// Should not throw
			view.toggleAudio();
			expect(mockAudioInstance.play).not.toHaveBeenCalled();
		});

		it('skipAudio() delegates to audioPlayer.skip() with correct delta', async () => {
			await setupTranscriptView();

			view.skipAudio(5);
			// skip(5) calls seekTo(currentTime + 5), which sets audioEl.currentTime
			expect(mockAudioInstance.currentTime).toBe(5);

			view.skipAudio(-3);
			expect(mockAudioInstance.currentTime).toBe(2);
		});

		it('skipAudio() is no-op when audioPlayer is null', async () => {
			await view.onOpen();
			// No transcript loaded, no audioPlayer
			view.skipAudio(5);
			// Should not throw, currentTime should remain at default
			expect(mockAudioInstance.currentTime).toBe(0);
		});

		it('cleans up sync state when destroying audio player', async () => {
			const { fireTimeUpdate } = await setupTranscriptView();

			fireTimeUpdate(5);
			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(true);

			// Return to session list (destroys player)
			view.showSessionList();

			// Re-open transcript — should not have stale highlight state
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			const session = createCompleteSession();
			await view.showTranscript(session.id);

			const newBubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			for (const b of Array.from(newBubbles)) {
				expect(b.classList.contains('meeting-scribe-sidebar-bubble--active')).toBe(false);
			}
		});
	});

	describe('Inline transcript editing', () => {
		function createCompleteSession(): MeetingSession {
			const session = sessionManager.createSession('audio/test.webm');
			sessionManager.updateSessionState(session.id, {
				status: 'complete',
				progress: 100,
				completedSteps: ['transcribe', 'summarize', 'generate'],
			});
			return sessionManager.getSession(session.id)!;
		}

		async function setupTranscriptView(): Promise<{ session: MeetingSession }> {
			const session = createCompleteSession();
			mockLoadTranscriptData.mockResolvedValueOnce(createMockTranscriptData());
			mockSaveTranscriptData.mockClear();
			await view.onOpen();
			await view.showTranscript(session.id);
			return { session };
		}

		function getBubbleText(index: number): HTMLElement {
			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble-text');
			return bubbles[index] as HTMLElement;
		}

		function getBubble(index: number): HTMLElement {
			const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
			return bubbles[index] as HTMLElement;
		}

		describe('Edit mode activation (AC #1)', () => {
			it('makes text editable on click', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();

				expect(textEl.contentEditable).toBe('true');
			});

			it('adds editing class to bubble on click', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);
				const bubble = getBubble(0);

				textEl.click();

				expect(bubble.classList.contains('meeting-scribe-sidebar-bubble--editing')).toBe(true);
			});

			it('stores original text as data attribute on edit activation', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();

				expect(textEl.getAttribute('data-original-text')).toBe('Hello there.');
			});
		});

		describe('Save on blur (AC #2)', () => {
			it('saves edited text to transcript data on blur', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				// Enter edit mode
				textEl.click();
				// Simulate text edit
				textEl.textContent = 'Edited text';
				// Blur to save
				textEl.dispatchEvent(new Event('blur', { bubbles: true }));

				expect(mockSaveTranscriptData).toHaveBeenCalledOnce();
				const savedData = mockSaveTranscriptData.mock.calls[0]![2];
				expect(savedData.segments[0]!.text).toBe('Edited text');
			});

			it('exits edit mode on blur', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);
				const bubble = getBubble(0);

				textEl.click();
				textEl.dispatchEvent(new Event('blur', { bubbles: true }));

				expect(textEl.contentEditable).toBe('false');
				expect(bubble.classList.contains('meeting-scribe-sidebar-bubble--editing')).toBe(false);
			});

			it('does not save when text is unchanged', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();
				// Don't change text, just blur
				textEl.dispatchEvent(new Event('blur', { bubbles: true }));

				expect(mockSaveTranscriptData).not.toHaveBeenCalled();
			});
		});

		describe('Escape to cancel (AC #3)', () => {
			it('restores original text on Escape', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();
				textEl.textContent = 'Changed text';
				textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

				expect(textEl.textContent).toBe('Hello there.');
			});

			it('exits edit mode on Escape', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);
				const bubble = getBubble(0);

				textEl.click();
				textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

				expect(textEl.contentEditable).toBe('false');
				expect(bubble.classList.contains('meeting-scribe-sidebar-bubble--editing')).toBe(false);
			});

			it('does not save on Escape', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();
				textEl.textContent = 'Changed';
				textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

				expect(mockSaveTranscriptData).not.toHaveBeenCalled();
			});
		});

		describe('Hover action buttons (AC #4)', () => {
			it('renders action buttons container in each bubble', async () => {
				await setupTranscriptView();

				const actions = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble-actions');
				expect(actions.length).toBe(3); // One per bubble
			});

			it('action buttons contain delete and split buttons', async () => {
				await setupTranscriptView();

				const actions = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-actions')!;
				const deleteBtn = actions.querySelector('.meeting-scribe-sidebar-bubble-delete-btn');
				const splitBtn = actions.querySelector('.meeting-scribe-sidebar-bubble-split-btn');

				expect(deleteBtn).not.toBeNull();
				expect(splitBtn).not.toBeNull();
			});

			it('action buttons use SVG icons (no emoji)', async () => {
				await setupTranscriptView();

				const actions = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-actions')!;
				const buttons = actions.querySelectorAll('button');
				for (const btn of Array.from(buttons)) {
					expect(btn.querySelector('svg')).not.toBeNull();
				}
			});
		});

		describe('Delete segment (AC #5)', () => {
			it('removes segment from data and DOM after confirmation', async () => {
				await setupTranscriptView();

				const deleteBtn = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-delete-btn') as HTMLElement;
				deleteBtn.click();

				// Find the confirmation modal and click "Confirm"
				const modalConfirmBtn = document.querySelector('.meeting-scribe-modal-actions .mod-warning') as HTMLElement;
				expect(modalConfirmBtn).not.toBeNull();
				modalConfirmBtn.click();

				// Wait for async delete to complete
				await vi.waitFor(() => {
					expect(mockSaveTranscriptData).toHaveBeenCalledOnce();
				});
				const savedData = mockSaveTranscriptData.mock.calls[0]![2];
				expect(savedData.segments.length).toBe(2);
				expect(savedData.segments.find((s: { id: string }) => s.id === 'seg-1')).toBeUndefined();

				// DOM should also update
				await vi.waitFor(() => {
					const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
					expect(bubbles.length).toBe(2);
				});
			});

			it('does nothing when confirmation is cancelled', async () => {
				await setupTranscriptView();

				const deleteBtn = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-delete-btn') as HTMLElement;
				deleteBtn.click();

				// Find the confirmation modal and click "Cancel"
				const modalCancelBtn = document.querySelector('.meeting-scribe-modal-actions button:not(.mod-warning)') as HTMLElement;
				expect(modalCancelBtn).not.toBeNull();
				modalCancelBtn.click();

				expect(mockSaveTranscriptData).not.toHaveBeenCalled();
				const bubbles = view.contentEl.querySelectorAll('.meeting-scribe-sidebar-bubble');
				expect(bubbles.length).toBe(3);
			});
		});

		describe('Split segment (AC #6)', () => {
			it('splits segment into two with same speaker', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				// Enter edit mode to place cursor
				textEl.click();

				// Mock getSelection to return cursor at position 5 ("Hello" | " there.")
				const mockRange = {
					startContainer: textEl.firstChild!,
					startOffset: 5,
					collapsed: true,
				};
				const mockSelection = {
					rangeCount: 1,
					getRangeAt: vi.fn().mockReturnValue(mockRange),
					anchorNode: textEl.firstChild,
					anchorOffset: 5,
				};
				vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

				const splitBtn = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-split-btn') as HTMLElement;
				splitBtn.click();

				expect(mockSaveTranscriptData).toHaveBeenCalledOnce();
				const savedData = mockSaveTranscriptData.mock.calls[0]![2];
				expect(savedData.segments.length).toBe(4); // 3 original - 1 + 2 = 4
				expect(savedData.segments[0].text).toBe('Hello');
				expect(savedData.segments[1].text).toBe('there.');
				expect(savedData.segments[0].speaker).toBe('Participant 1');
				expect(savedData.segments[1].speaker).toBe('Participant 1');

				vi.mocked(window.getSelection).mockRestore();
			});

			it('does not split when cursor is at start or end', async () => {
				await setupTranscriptView();
				const textEl = getBubbleText(0);

				textEl.click();

				// Cursor at position 0 (start)
				const mockRange = {
					startContainer: textEl.firstChild!,
					startOffset: 0,
					collapsed: true,
				};
				const mockSelection = {
					rangeCount: 1,
					getRangeAt: vi.fn().mockReturnValue(mockRange),
					anchorNode: textEl.firstChild,
					anchorOffset: 0,
				};
				vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

				const splitBtn = getBubble(0).querySelector('.meeting-scribe-sidebar-bubble-split-btn') as HTMLElement;
				splitBtn.click();

				expect(mockSaveTranscriptData).not.toHaveBeenCalled();

				vi.mocked(window.getSelection).mockRestore();
			});
		});
	});
});
