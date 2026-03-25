import type { TranscriptSegmentV2, ParticipantMapping } from '../../transcript/transcript-data';
import { formatSpeakerDisplayName, hasWikiLink } from './speaker-popover';

// Fallback hue if --interactive-accent cannot be parsed
const DEFAULT_BASE_HUE = 260;
const HUE_ROTATION = 120;

/**
 * Derive speaker border color from Obsidian's --interactive-accent with hue rotation.
 * Returns an hsl() string.
 */
export function getSpeakerColor(participant: ParticipantMapping): string {
	const baseHue = getBaseHue();
	const hue = (baseHue + HUE_ROTATION * participant.color) % 360;
	return `hsl(${hue}, 60%, 55%)`;
}

function getBaseHue(): number {
	try {
		const accent = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
		if (!accent) return DEFAULT_BASE_HUE;
		return parseColorToHue(accent);
	} catch {
		return DEFAULT_BASE_HUE;
	}
}

function parseColorToHue(color: string): number {
	// Handle hex colors
	if (color.startsWith('#')) {
		const hex = color.slice(1);
		let r: number, g: number, b: number;
		if (hex.length === 3) {
			r = parseInt((hex[0] ?? '0') + (hex[0] ?? '0'), 16) / 255;
			g = parseInt((hex[1] ?? '0') + (hex[1] ?? '0'), 16) / 255;
			b = parseInt((hex[2] ?? '0') + (hex[2] ?? '0'), 16) / 255;
		} else {
			r = parseInt(hex.slice(0, 2), 16) / 255;
			g = parseInt(hex.slice(2, 4), 16) / 255;
			b = parseInt(hex.slice(4, 6), 16) / 255;
		}
		return rgbToHue(r, g, b);
	}

	// Handle rgb/rgba
	const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
		return rgbToHue(
			parseInt(rgbMatch[1]) / 255,
			parseInt(rgbMatch[2]) / 255,
			parseInt(rgbMatch[3]) / 255,
		);
	}

	// Handle hsl
	const hslMatch = color.match(/hsla?\(\s*([\d.]+)/);
	if (hslMatch && hslMatch[1]) {
		return parseFloat(hslMatch[1]);
	}

	return DEFAULT_BASE_HUE;
}

function rgbToHue(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) return DEFAULT_BASE_HUE;

	let hue: number;
	if (max === r) {
		hue = ((g - b) / delta) % 6;
	} else if (max === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}
	hue = Math.round(hue * 60);
	if (hue < 0) hue += 360;
	return hue;
}

export function formatTimestamp(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

function findParticipant(
	participants: ParticipantMapping[],
	speaker: string,
): ParticipantMapping | undefined {
	return participants.find((p) => p.alias === speaker || p.name === speaker);
}

/**
 * Render transcript segments as chat bubbles into the container.
 * Uses DocumentFragment for performance with large segment counts.
 */
export function renderTranscriptView(
	container: HTMLElement,
	segments: TranscriptSegmentV2[],
	participants: ParticipantMapping[],
): void {
	if (segments.length === 0) {
		const emptyEl = document.createElement('div');
		emptyEl.className = 'meeting-scribe-sidebar-empty';
		emptyEl.textContent = 'No transcript segments available.';
		container.appendChild(emptyEl);
		return;
	}

	const fragment = document.createDocumentFragment();
	let previousSpeaker = '';

	for (const segment of segments) {
		const participant = findParticipant(participants, segment.speaker);
		const isConsecutive = segment.speaker === previousSpeaker;

		const bubble = document.createElement('div');
		bubble.className = 'meeting-scribe-sidebar-bubble';
		if (isConsecutive) {
			bubble.classList.add('meeting-scribe-sidebar-bubble--consecutive');
		}

		// Segment identification for playback sync (Story 13.2)
		bubble.setAttribute('data-segment-id', segment.id);
		bubble.setAttribute('data-segment-start', String(segment.start));
		bubble.setAttribute('data-segment-end', String(segment.end));

		// Speaker border color as CSS variable for highlight state
		if (participant) {
			bubble.style.setProperty('--speaker-border-color', getSpeakerColor(participant));
		}

		const displayName = participant
			? formatSpeakerDisplayName(participant, segment.speaker)
			: segment.speaker;
		bubble.setAttribute('aria-label', `Speaker: ${displayName}`);
		bubble.tabIndex = 0;

		// Speaker row: colored name + timestamp on same line (name omitted for consecutive)
		const speakerRow = document.createElement('div');
		speakerRow.className = 'meeting-scribe-sidebar-bubble-speaker-row';

		if (!isConsecutive) {
			const speakerEl = document.createElement('span');
			speakerEl.className = 'meeting-scribe-sidebar-bubble-speaker meeting-scribe-sidebar-bubble-speaker--clickable';
			speakerEl.textContent = displayName;
			speakerEl.setAttribute('data-speaker-alias', segment.speaker);
			if (participant) {
				speakerEl.style.color = getSpeakerColor(participant);
			}
			speakerRow.appendChild(speakerEl);

			// Wiki-link indicator icon
			if (participant && hasWikiLink(participant)) {
				const linkIcon = document.createElement('span');
				linkIcon.className = 'meeting-scribe-sidebar-bubble-speaker-link-icon';
				linkIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
				linkIcon.setAttribute('aria-label', 'Wiki-linked');
				speakerRow.appendChild(linkIcon);
			}
		}

		const timestampEl = document.createElement('span');
		timestampEl.className = 'meeting-scribe-sidebar-bubble-timestamp meeting-scribe-sidebar-bubble-timestamp--clickable';
		timestampEl.textContent = formatTimestamp(segment.start);
		timestampEl.setAttribute('data-start', String(segment.start));
		speakerRow.appendChild(timestampEl);

		bubble.appendChild(speakerRow);

		const textEl = document.createElement('div');
		textEl.className = 'meeting-scribe-sidebar-bubble-text';
		textEl.textContent = segment.text;
		bubble.appendChild(textEl);

		// Hover action buttons (delete + split)
		const actionsEl = document.createElement('div');
		actionsEl.className = 'meeting-scribe-sidebar-bubble-actions';

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'meeting-scribe-sidebar-bubble-delete-btn';
		deleteBtn.setAttribute('aria-label', 'Delete segment');
		deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>';
		actionsEl.appendChild(deleteBtn);

		const splitBtn = document.createElement('button');
		splitBtn.className = 'meeting-scribe-sidebar-bubble-split-btn';
		splitBtn.setAttribute('aria-label', 'Split segment at cursor (enter edit mode first)');
		splitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/></svg>';
		actionsEl.appendChild(splitBtn);

		bubble.appendChild(actionsEl);

		fragment.appendChild(bubble);
		previousSpeaker = segment.speaker;
	}

	container.appendChild(fragment);
}
