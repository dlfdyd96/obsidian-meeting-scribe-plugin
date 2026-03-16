// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { NoticeManager } from '../../src/ui/notices';
import { ConfigError } from '../../src/utils/errors';

describe('NoticeManager', () => {
	let mockApp: {
		workspace: { openLinkText: ReturnType<typeof vi.fn> };
		setting: { open: ReturnType<typeof vi.fn>; openTabById: ReturnType<typeof vi.fn> };
	};
	let onRetry: ReturnType<typeof vi.fn>;
	let manager: NoticeManager;

	beforeEach(() => {
		mockApp = {
			workspace: {
				openLinkText: vi.fn().mockResolvedValue(undefined),
			},
			setting: {
				open: vi.fn(),
				openTabById: vi.fn(),
			},
		};
		onRetry = vi.fn();
		manager = new NoticeManager(mockApp as never, onRetry, 'meeting-scribe');
	});

	describe('showSuccess', () => {
		it('should create a notice with 5000ms timeout', () => {
			const notice = manager.showSuccess('meetings/note.md');
			expect((notice as unknown as { timeout?: number }).timeout).toBe(5000);
		});

		it('should contain "Meeting note created" text', () => {
			const notice = manager.showSuccess('meetings/note.md');
			expect(notice.noticeEl.textContent).toContain('Meeting note created');
		});

		it('should contain clickable "click to open" text', () => {
			const notice = manager.showSuccess('meetings/note.md');
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link');
			expect(link).not.toBeNull();
			expect(link!.textContent).toContain('click to open');
		});

		it('should open note file in new tab when link is clicked', () => {
			const notice = manager.showSuccess('meetings/note.md');
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link') as HTMLElement;
			link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith('meetings/note.md', '', true);
		});

		it('should hide notice after clicking link', () => {
			const notice = manager.showSuccess('meetings/note.md');
			const hideSpy = vi.spyOn(notice, 'hide');
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link') as HTMLElement;
			link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(hideSpy).toHaveBeenCalled();
		});
	});

	describe('showRetry', () => {
		it('should create a notice with 2000ms timeout', () => {
			const notice = manager.showRetry(1, 3);
			expect((notice as unknown as { timeout?: number }).timeout).toBe(2000);
		});

		it('should display "Retrying... (1/3)" format', () => {
			const notice = manager.showRetry(1, 3);
			expect(notice.noticeEl.textContent).toBe('Retrying... (1/3)');
		});

		it('should display correct attempt number', () => {
			const notice = manager.showRetry(2, 3);
			expect(notice.noticeEl.textContent).toBe('Retrying... (2/3)');
		});
	});

	describe('showError (retryable)', () => {
		it('should create a persistent notice (timeout=0)', () => {
			const error = new Error('Network timeout');
			const notice = manager.showError('transcribing', error);
			expect((notice as unknown as { timeout?: number }).timeout).toBe(0);
		});

		it('should display step name and error message', () => {
			const error = new Error('Network timeout');
			const notice = manager.showError('transcribing', error);
			expect(notice.noticeEl.textContent).toContain('Transcription');
			expect(notice.noticeEl.textContent).toContain('Network timeout');
		});

		it('should map raw step keys to display names', () => {
			const error = new Error('fail');
			const steps: [string, string][] = [
				['transcribing', 'Transcription'],
				['summarizing', 'Summarization'],
				['generating', 'Note generation'],
			];
			for (const [raw, display] of steps) {
				const notice = manager.showError(raw, error);
				expect(notice.noticeEl.textContent).toContain(display);
			}
		});

		it('should fall back to raw step name for unknown steps', () => {
			const error = new Error('fail');
			const notice = manager.showError('unknown-step', error);
			expect(notice.noticeEl.textContent).toContain('unknown-step');
		});

		it('should include "Original audio is safe." reassurance', () => {
			const error = new Error('Network timeout');
			const notice = manager.showError('transcribing', error);
			expect(notice.noticeEl.textContent).toContain('Original audio is safe.');
		});

		it('should show Retry link when onRetry is provided', () => {
			const error = new Error('Network timeout');
			const notice = manager.showError('transcribing', error);
			const retryLink = notice.noticeEl.querySelector('.meeting-scribe-notice-link');
			expect(retryLink).not.toBeNull();
			expect(retryLink!.textContent).toBe('Retry');
		});

		it('should call onRetry and hide notice when Retry is clicked', () => {
			const error = new Error('Network timeout');
			const notice = manager.showError('transcribing', error);
			const hideSpy = vi.spyOn(notice, 'hide');
			const retryLink = notice.noticeEl.querySelector('.meeting-scribe-notice-link') as HTMLElement;
			retryLink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onRetry).toHaveBeenCalled();
			expect(hideSpy).toHaveBeenCalled();
		});

		it('should NOT show Retry link when onRetry is not provided', () => {
			const managerNoRetry = new NoticeManager(mockApp as never, undefined, 'meeting-scribe');
			const error = new Error('Network timeout');
			const notice = managerNoRetry.showError('transcribing', error);
			const retryLink = notice.noticeEl.querySelector('.meeting-scribe-notice-link');
			expect(retryLink).toBeNull();
		});
	});

	describe('showConfigError', () => {
		it('should create a persistent notice (timeout=0)', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			expect((notice as unknown as { timeout?: number }).timeout).toBe(0);
		});

		it('should display error message', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			expect(notice.noticeEl.textContent).toContain('Invalid API key');
		});

		it('should include "Original audio is safe." reassurance', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			expect(notice.noticeEl.textContent).toContain('Original audio is safe.');
		});

		it('should show "Open Settings" link instead of Retry', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link');
			expect(link).not.toBeNull();
			expect(link!.textContent).toBe('Open Settings');
		});

		it('should open settings tab and hide notice when link is clicked', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			const hideSpy = vi.spyOn(notice, 'hide');
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link') as HTMLElement;
			link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(mockApp.setting.open).toHaveBeenCalled();
			expect(mockApp.setting.openTabById).toHaveBeenCalledWith('meeting-scribe');
			expect(hideSpy).toHaveBeenCalled();
		});

		it('should NOT show Retry link even when onRetry is provided', () => {
			const error = new ConfigError('Invalid API key');
			const notice = manager.showConfigError(error);
			const links = notice.noticeEl.querySelectorAll('.meeting-scribe-notice-link');
			expect(links.length).toBe(1);
			expect(links[0]!.textContent).toBe('Open Settings');
		});
	});

	describe('showTestSuccess', () => {
		it('should create a notice with 5000ms timeout', () => {
			const notice = manager.showTestSuccess();
			expect((notice as unknown as { timeout?: number }).timeout).toBe(5000);
		});

		it('should display test success message', () => {
			const notice = manager.showTestSuccess();
			expect(notice.noticeEl.textContent).toContain('Test complete');
			expect(notice.noticeEl.textContent).toContain('setup is working');
		});
	});

	describe('showError with ConfigError delegates to showConfigError', () => {
		it('should show settings link instead of retry for ConfigError', () => {
			const error = new ConfigError('Bad key');
			const notice = manager.showError('transcribing', error);
			const link = notice.noticeEl.querySelector('.meeting-scribe-notice-link');
			expect(link).not.toBeNull();
			expect(link!.textContent).toBe('Open Settings');
		});
	});
});
