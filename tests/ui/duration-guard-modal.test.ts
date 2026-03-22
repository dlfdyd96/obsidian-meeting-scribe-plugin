// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DurationGuardModal } from '../../src/ui/duration-guard-modal';
import type { App } from 'obsidian';

function createMockApp(): App {
	return {} as App;
}

describe('DurationGuardModal', () => {
	let app: App;

	beforeEach(() => {
		app = createMockApp();
	});

	it('should create modal with correct warning message', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		modal.onOpen();

		const text = modal.contentEl.textContent;
		expect(text).toContain('30');
		expect(text).toContain('OpenAI');
		expect(text).toContain('23');
	});

	it('should show Split button', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		expect(buttonTexts).toContain('Split into chunks');
	});

	it('should show Cancel button', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		expect(buttonTexts).toContain('Cancel');
	});

	it('should NOT show Switch button when no alternatives', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		const switchButtons = buttonTexts.filter(t => t?.startsWith('Switch to'));
		expect(switchButtons).toHaveLength(0);
	});

	it('should show Switch button for each viable alternative provider', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 150,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [
				{ provider: 'clova', model: 'clova-sync', displayName: 'CLOVA Speech', limitMinutes: 120 },
				{ provider: 'gemini', model: 'gemini-2.5-flash', displayName: 'Gemini', limitMinutes: 570 },
			],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		expect(buttonTexts).toContain('Switch to Gemini (up to 570 min)');
	});

	it('should only show alternatives that can handle the duration', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 150,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [
				{ provider: 'clova', model: 'clova-sync', displayName: 'CLOVA Speech', limitMinutes: 120 },
			],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		const switchButtons = buttonTexts.filter(t => t?.startsWith('Switch to'));
		// CLOVA only supports 120 min, audio is 150 min — should not show
		expect(switchButtons).toHaveLength(0);
	});

	it('should show unlimited providers with "no limit" text', () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'CLOVA Speech',
			limitMinutes: 120,
			alternatives: [
				{ provider: 'openai', model: 'gpt-4o-mini-transcribe', displayName: 'OpenAI', limitMinutes: null },
			],
		});

		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const buttonTexts = Array.from(buttons).map(b => b.textContent);
		expect(buttonTexts).toContain('Switch to OpenAI (no limit)');
	});

	it('should resolve with split action when Split button clicked', async () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		const promise = modal.getResult();
		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const splitBtn = Array.from(buttons).find(b => b.textContent === 'Split into chunks');
		splitBtn?.click();

		const result = await promise;
		expect(result).toEqual({ action: 'split' });
	});

	it('should resolve with cancel action when Cancel button clicked', async () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		const promise = modal.getResult();
		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const cancelBtn = Array.from(buttons).find(b => b.textContent === 'Cancel');
		cancelBtn?.click();

		const result = await promise;
		expect(result).toEqual({ action: 'cancel' });
	});

	it('should resolve with switch action including model when Switch button clicked', async () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [
				{ provider: 'gemini', model: 'gemini-2.5-flash', displayName: 'Gemini', limitMinutes: 570 },
			],
		});

		const promise = modal.getResult();
		modal.onOpen();

		const buttons = modal.contentEl.querySelectorAll('button');
		const switchBtn = Array.from(buttons).find(b => b.textContent?.startsWith('Switch to'));
		switchBtn?.click();

		const result = await promise;
		expect(result).toEqual({ action: 'switch', switchProvider: 'gemini', switchModel: 'gemini-2.5-flash' });
	});

	it('should resolve with cancel when modal is closed without action', async () => {
		const modal = new DurationGuardModal(app, {
			durationMinutes: 30,
			providerName: 'OpenAI',
			limitMinutes: 23,
			alternatives: [],
		});

		const promise = modal.getResult();
		modal.onOpen();
		modal.onClose();

		const result = await promise;
		expect(result).toEqual({ action: 'cancel' });
	});
});
