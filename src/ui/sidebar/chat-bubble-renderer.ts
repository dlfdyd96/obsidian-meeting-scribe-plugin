import type { TranscriptSegmentV2, ParticipantMapping } from '../../transcript/transcript-data';

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
		if (participant) {
			bubble.style.borderLeftColor = getSpeakerColor(participant);
		}

		const displayName = participant?.name || segment.speaker;
		bubble.setAttribute('aria-label', `Speaker: ${displayName}`);
		bubble.tabIndex = 0;

		if (!isConsecutive) {
			const speakerEl = document.createElement('span');
			speakerEl.className = 'meeting-scribe-sidebar-bubble-speaker';
			speakerEl.textContent = displayName;
			bubble.appendChild(speakerEl);
		}

		const timestampEl = document.createElement('span');
		timestampEl.className = 'meeting-scribe-sidebar-bubble-timestamp';
		timestampEl.textContent = formatTimestamp(segment.start);
		bubble.appendChild(timestampEl);

		const textEl = document.createElement('div');
		textEl.className = 'meeting-scribe-sidebar-bubble-text';
		textEl.textContent = segment.text;
		bubble.appendChild(textEl);

		fragment.appendChild(bubble);
		previousSpeaker = segment.speaker;
	}

	container.appendChild(fragment);
}
