// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	renderTranscriptView,
	getSpeakerColor,
	formatTimestamp,
} from '../../../src/ui/sidebar/chat-bubble-renderer';
import type {
	TranscriptSegmentV2,
	ParticipantMapping,
} from '../../../src/transcript/transcript-data';

function createSegment(overrides: Partial<TranscriptSegmentV2> = {}): TranscriptSegmentV2 {
	return {
		id: 'seg-1',
		speaker: 'Participant 1',
		start: 0,
		end: 10,
		text: 'Hello there.',
		...overrides,
	};
}

function createParticipant(overrides: Partial<ParticipantMapping> = {}): ParticipantMapping {
	return {
		alias: 'Participant 1',
		name: '',
		wikiLink: false,
		color: 0,
		...overrides,
	};
}

describe('chat-bubble-renderer', () => {
	describe('renderTranscriptView()', () => {
		it('renders all segments as bubbles', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ id: 'seg-1', speaker: 'Participant 1', start: 0, text: 'Hello' }),
				createSegment({ id: 'seg-2', speaker: 'Participant 2', start: 10, text: 'Hi there' }),
				createSegment({ id: 'seg-3', speaker: 'Participant 1', start: 20, text: 'How are you?' }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
				createParticipant({ alias: 'Participant 2', color: 1 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubbles = container.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles.length).toBe(3);
		});

		it('renders speaker name, timestamp, and text in each bubble', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Participant 1', start: 135, text: 'Test content' }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble')!;
			const speaker = bubble.querySelector('.meeting-scribe-sidebar-bubble-speaker');
			const timestamp = bubble.querySelector('.meeting-scribe-sidebar-bubble-timestamp');
			const text = bubble.querySelector('.meeting-scribe-sidebar-bubble-text');

			expect(speaker).not.toBeNull();
			expect(speaker!.textContent).toBe('Participant 1');
			expect(timestamp!.textContent).toBe('[00:02:15]');
			expect(text!.textContent).toBe('Test content');
		});

		it('omits speaker name for consecutive same-speaker segments', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ id: 'seg-1', speaker: 'Participant 1', start: 0, text: 'First' }),
				createSegment({ id: 'seg-2', speaker: 'Participant 1', start: 10, text: 'Second' }),
				createSegment({ id: 'seg-3', speaker: 'Participant 2', start: 20, text: 'Third' }),
				createSegment({ id: 'seg-4', speaker: 'Participant 2', start: 30, text: 'Fourth' }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
				createParticipant({ alias: 'Participant 2', color: 1 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubbles = container.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles.length).toBe(4);

			// First bubble of each speaker group has speaker name
			expect(bubbles[0]!.querySelector('.meeting-scribe-sidebar-bubble-speaker')).not.toBeNull();
			// Second consecutive same speaker omits name
			expect(bubbles[1]!.querySelector('.meeting-scribe-sidebar-bubble-speaker')).toBeNull();
			// New speaker shows name
			expect(bubbles[2]!.querySelector('.meeting-scribe-sidebar-bubble-speaker')).not.toBeNull();
			// Consecutive same speaker omits name
			expect(bubbles[3]!.querySelector('.meeting-scribe-sidebar-bubble-speaker')).toBeNull();
		});

		it('applies speaker color to speaker name via inline style', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Participant 1', start: 0 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
			];

			renderTranscriptView(container, segments, participants);

			const speakerEl = container.querySelector('.meeting-scribe-sidebar-bubble-speaker') as HTMLElement;
			expect(speakerEl.style.color).not.toBe('');
		});

		it('renders different speaker name colors for different speakers', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ id: 'seg-1', speaker: 'Participant 1', start: 0 }),
				createSegment({ id: 'seg-2', speaker: 'Participant 2', start: 10 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
				createParticipant({ alias: 'Participant 2', color: 1 }),
			];

			renderTranscriptView(container, segments, participants);

			const speakers = container.querySelectorAll('.meeting-scribe-sidebar-bubble-speaker') as NodeListOf<HTMLElement>;
			expect(speakers[0]!.style.color).not.toBe(speakers[1]!.style.color);
		});

		it('renders empty state when no segments', () => {
			const container = document.createElement('div');
			renderTranscriptView(container, [], []);

			const empty = container.querySelector('.meeting-scribe-sidebar-empty');
			expect(empty).not.toBeNull();
			expect(empty!.textContent).toContain('No transcript segments');
		});

		it('sets aria-label on each bubble', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Participant 1', start: 0 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble') as HTMLElement;
			expect(bubble.getAttribute('aria-label')).toBe('Speaker: Participant 1');
			expect(bubble.tabIndex).toBe(0);
		});

		it('uses participant mapped name in aria-label when available', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Participant 1', start: 0 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', name: 'John', color: 0 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble') as HTMLElement;
			expect(bubble.getAttribute('aria-label')).toBe('Speaker: John');
		});

		it('displays mapped name instead of alias when available', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Participant 1', start: 0 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', name: 'John', color: 0 }),
			];

			renderTranscriptView(container, segments, participants);

			const speaker = container.querySelector('.meeting-scribe-sidebar-bubble-speaker');
			expect(speaker!.textContent).toBe('John');
		});

		it('falls back to segment speaker when no participant match', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ speaker: 'Unknown Speaker', start: 0 }),
			];

			renderTranscriptView(container, segments, []);

			const speaker = container.querySelector('.meeting-scribe-sidebar-bubble-speaker');
			expect(speaker!.textContent).toBe('Unknown Speaker');
		});
	});

	describe('segment data attributes for playback sync', () => {
		it('adds data-segment-id, data-segment-start, data-segment-end to each bubble', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ id: 'seg-abc', start: 5.5, end: 12.3 }),
			];
			const participants = [createParticipant()];

			renderTranscriptView(container, segments, participants);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble') as HTMLElement;
			expect(bubble.getAttribute('data-segment-id')).toBe('seg-abc');
			expect(bubble.getAttribute('data-segment-start')).toBe('5.5');
			expect(bubble.getAttribute('data-segment-end')).toBe('12.3');
		});

		it('adds data-start attribute and clickable class to timestamp span', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ start: 135 }),
			];
			const participants = [createParticipant()];

			renderTranscriptView(container, segments, participants);

			const timestamp = container.querySelector('.meeting-scribe-sidebar-bubble-timestamp') as HTMLElement;
			expect(timestamp.getAttribute('data-start')).toBe('135');
			expect(timestamp.classList.contains('meeting-scribe-sidebar-bubble-timestamp--clickable')).toBe(true);
		});

		it('sets --speaker-border-color CSS variable on bubble when participant exists', () => {
			const container = document.createElement('div');
			const segments = [createSegment()];
			const participants = [createParticipant({ color: 0 })];

			renderTranscriptView(container, segments, participants);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble') as HTMLElement;
			expect(bubble.style.getPropertyValue('--speaker-border-color')).toMatch(/^hsl\(/);
		});

		it('does not set --speaker-border-color when no participant match', () => {
			const container = document.createElement('div');
			const segments = [createSegment({ speaker: 'Unknown' })];

			renderTranscriptView(container, segments, []);

			const bubble = container.querySelector('.meeting-scribe-sidebar-bubble') as HTMLElement;
			expect(bubble.style.getPropertyValue('--speaker-border-color')).toBe('');
		});

		it('sets correct data attributes on multiple bubbles', () => {
			const container = document.createElement('div');
			const segments = [
				createSegment({ id: 'seg-1', start: 0, end: 10 }),
				createSegment({ id: 'seg-2', speaker: 'Participant 2', start: 10, end: 20 }),
			];
			const participants = [
				createParticipant({ alias: 'Participant 1', color: 0 }),
				createParticipant({ alias: 'Participant 2', color: 1 }),
			];

			renderTranscriptView(container, segments, participants);

			const bubbles = container.querySelectorAll('.meeting-scribe-sidebar-bubble');
			expect(bubbles[0]!.getAttribute('data-segment-id')).toBe('seg-1');
			expect(bubbles[1]!.getAttribute('data-segment-id')).toBe('seg-2');
			expect(bubbles[1]!.getAttribute('data-segment-start')).toBe('10');
			expect(bubbles[1]!.getAttribute('data-segment-end')).toBe('20');
		});
	});

	describe('formatTimestamp()', () => {
		it('formats 0 seconds as [00:00:00]', () => {
			expect(formatTimestamp(0)).toBe('[00:00:00]');
		});

		it('formats seconds only', () => {
			expect(formatTimestamp(45)).toBe('[00:00:45]');
		});

		it('formats minutes and seconds', () => {
			expect(formatTimestamp(135)).toBe('[00:02:15]');
		});

		it('formats hours, minutes, and seconds', () => {
			expect(formatTimestamp(3723)).toBe('[01:02:03]');
		});

		it('handles decimal seconds by flooring', () => {
			expect(formatTimestamp(45.9)).toBe('[00:00:45]');
		});
	});

	describe('getSpeakerColor()', () => {
		it('returns a valid hsl string', () => {
			const color = getSpeakerColor(createParticipant({ color: 0 }));
			expect(color).toMatch(/^hsl\(\d+, 60%, 55%\)$/);
		});

		it('returns different colors for different participant indices', () => {
			const color0 = getSpeakerColor(createParticipant({ color: 0 }));
			const color1 = getSpeakerColor(createParticipant({ color: 1 }));
			const color2 = getSpeakerColor(createParticipant({ color: 2 }));

			expect(color0).not.toBe(color1);
			expect(color1).not.toBe(color2);
		});

		it('cycles colors after 3 speakers', () => {
			const color0 = getSpeakerColor(createParticipant({ color: 0 }));
			const color3 = getSpeakerColor(createParticipant({ color: 3 }));
			expect(color0).toBe(color3);
		});
	});
});
