// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderTranscriptView, getSpeakerColor } from '../../../src/ui/sidebar/chat-bubble-renderer';
import type { TranscriptSegmentV2, ParticipantMapping, TranscriptData } from '../../../src/transcript/transcript-data';
import {
	createSpeakerPopoverDOM,
	filterVaultFiles,
	updateParticipantMapping,
	formatSpeakerDisplayName,
} from '../../../src/ui/sidebar/speaker-popover';

function createSegments(): TranscriptSegmentV2[] {
	return [
		{ id: 'seg-1', speaker: 'Participant 1', start: 0, end: 10, text: 'Hello there.' },
		{ id: 'seg-2', speaker: 'Participant 2', start: 10, end: 20, text: 'Hi, how are you?' },
		{ id: 'seg-3', speaker: 'Participant 1', start: 20, end: 30, text: 'Doing well.' },
	];
}

function createParticipants(): ParticipantMapping[] {
	return [
		{ alias: 'Participant 1', name: '', wikiLink: false, color: 0 },
		{ alias: 'Participant 2', name: '', wikiLink: false, color: 1 },
	];
}

describe('Speaker Name Mapping', () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement('div');
	});

	describe('Speaker Name Display', () => {
		it('should display alias when participant name is empty', () => {
			const segments = createSegments();
			const participants = createParticipants();
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			// seg-1: Participant 1, seg-2: Participant 2, seg-3: Participant 1 (not consecutive — different speaker in between)
			expect(speakerEls.length).toBe(3);
			expect(speakerEls[0]!.textContent).toBe('Participant 1');
			expect(speakerEls[1]!.textContent).toBe('Participant 2');
			expect(speakerEls[2]!.textContent).toBe('Participant 1');
		});

		it('should display mapped name when participant name is set', () => {
			const segments = createSegments();
			const participants = createParticipants();
			participants[0]!.name = 'Alice';
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			expect(speakerEls[0]!.textContent).toBe('Alice');
		});

		it('should display plain name with link icon when wikiLink is true', () => {
			const segments = createSegments();
			const participants = createParticipants();
			participants[0]!.name = 'Alice';
			participants[0]!.wikiLink = true;
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			expect(speakerEls[0]!.textContent).toBe('Alice');

			// Should have link icon next to speaker name
			const linkIcons = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker-link-icon');
			expect(linkIcons.length).toBeGreaterThanOrEqual(1);
			expect(linkIcons[0]!.querySelector('svg')).not.toBeNull();
		});

		it('should display plain name when wikiLink is false', () => {
			const segments = createSegments();
			const participants = createParticipants();
			participants[0]!.name = 'Alice';
			participants[0]!.wikiLink = false;
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			expect(speakerEls[0]!.textContent).toBe('Alice');
		});

		it('should add clickable class to speaker name elements', () => {
			const segments = createSegments();
			const participants = createParticipants();
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			for (const el of speakerEls) {
				expect(el.classList.contains('meeting-scribe-sidebar-bubble-speaker--clickable')).toBe(true);
			}
		});

		it('should store speaker alias as data attribute', () => {
			const segments = createSegments();
			const participants = createParticipants();
			participants[0]!.name = 'Alice';
			renderTranscriptView(container, segments, participants);

			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			expect(speakerEls[0]!.getAttribute('data-speaker-alias')).toBe('Participant 1');
		});
	});

	describe('Popover DOM Creation', () => {
		it('should create popover with input, checkbox, and buttons', () => {
			const popover = createSpeakerPopoverDOM('Participant 1', '', false);
			expect(popover.querySelector('.meeting-scribe-sidebar-speaker-popover-input')).not.toBeNull();
			expect(popover.querySelector('input[type="checkbox"]')).not.toBeNull();
			expect(popover.querySelector('.meeting-scribe-sidebar-speaker-popover-cancel-btn')).not.toBeNull();
			expect(popover.querySelector('.meeting-scribe-sidebar-speaker-popover-apply-btn')).not.toBeNull();
		});

		it('should pre-fill input with current mapped name', () => {
			const popover = createSpeakerPopoverDOM('Participant 1', 'Alice', true);
			const input = popover.querySelector('.meeting-scribe-sidebar-speaker-popover-input') as HTMLInputElement;
			expect(input.value).toBe('Alice');
		});

		it('should default wiki-link checkbox to checked', () => {
			const popover = createSpeakerPopoverDOM('Participant 1', '', false);
			const checkbox = popover.querySelector('input[type="checkbox"]') as HTMLInputElement;
			expect(checkbox.checked).toBe(true);
		});

		it('should preserve existing wiki-link state for mapped speaker', () => {
			const popover = createSpeakerPopoverDOM('Participant 1', 'Alice', false);
			const checkbox = popover.querySelector('input[type="checkbox"]') as HTMLInputElement;
			expect(checkbox.checked).toBe(false);
		});
	});

	describe('Vault File Filtering', () => {
		it('should filter files by lowercase prefix', () => {
			const files = [
				{ basename: 'Alice', path: 'Alice.md' },
				{ basename: 'Bob', path: 'Bob.md' },
				{ basename: 'Alicia', path: 'Alicia.md' },
				{ basename: 'Charlie', path: 'Charlie.md' },
			];
			const result = filterVaultFiles(files, 'ali');
			expect(result.map(f => f.basename)).toEqual(['Alice', 'Alicia']);
		});

		it('should return empty array for empty query', () => {
			const files = [{ basename: 'Alice', path: 'Alice.md' }];
			expect(filterVaultFiles(files, '')).toEqual([]);
		});

		it('should limit results to max count', () => {
			const files = Array.from({ length: 20 }, (_, i) => ({
				basename: `Note${i}`,
				path: `Note${i}.md`,
			}));
			const result = filterVaultFiles(files, 'note', 10);
			expect(result.length).toBe(10);
		});
	});

	describe('Participant Mapping Update', () => {
		it('should update participant name and wikiLink', () => {
			const participants = createParticipants();
			updateParticipantMapping(participants, 'Participant 1', 'Alice', true);
			expect(participants[0]!.name).toBe('Alice');
			expect(participants[0]!.wikiLink).toBe(true);
		});

		it('should not modify other participants', () => {
			const participants = createParticipants();
			updateParticipantMapping(participants, 'Participant 1', 'Alice', true);
			expect(participants[1]!.name).toBe('');
			expect(participants[1]!.wikiLink).toBe(false);
		});

		it('should preserve color index after name change', () => {
			const participants = createParticipants();
			const originalColor = participants[0]!.color;
			updateParticipantMapping(participants, 'Participant 1', 'Alice', true);
			expect(participants[0]!.color).toBe(originalColor);
		});
	});

	describe('Re-render After Name Change', () => {
		it('should show updated name in all bubbles for that speaker', () => {
			const segments = createSegments();
			const participants = createParticipants();
			participants[0]!.name = 'Alice';
			participants[0]!.wikiLink = true;

			renderTranscriptView(container, segments, participants);

			// seg-1 has speaker row with Alice; seg-3 is consecutive (no speaker row)
			const speakerEls = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker');
			expect(speakerEls[0]!.textContent).toBe('Alice');

			// Link icon should appear next to wiki-linked speaker
			const linkIcons = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker-link-icon');
			expect(linkIcons.length).toBeGreaterThanOrEqual(1);

			// All bubbles for Participant 1 should have correct aria-label (plain name)
			const bubbles = container.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.getAttribute('aria-label')).toBe('Speaker: Alice');
			expect(bubbles[2]!.getAttribute('aria-label')).toBe('Speaker: Alice');
		});
	});
});

