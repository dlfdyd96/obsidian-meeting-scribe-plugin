import type { ParticipantMapping } from '../../transcript/transcript-data';

const MAX_SUGGESTIONS = 10;

export interface SpeakerPopoverCallbacks {
	onApply: (name: string, wikiLink: boolean) => void;
	onCancel: () => void;
	getVaultFiles: () => { basename: string; path: string }[];
}

/**
 * Create the speaker name mapping popover DOM.
 * Pure DOM creation — no side-effects beyond building elements.
 */
export function createSpeakerPopoverDOM(
	alias: string,
	currentName: string,
	currentWikiLink: boolean,
): HTMLElement {
	const popover = document.createElement('div');
	popover.className = 'meeting-scribe-sidebar-speaker-popover';

	// Title
	const title = document.createElement('div');
	title.className = 'meeting-scribe-sidebar-speaker-popover-title';
	title.textContent = `Rename ${alias}`;
	popover.appendChild(title);

	// Text input
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'meeting-scribe-sidebar-speaker-popover-input';
	input.value = currentName;
	input.placeholder = 'Enter name...';
	popover.appendChild(input);

	// Suggestions container
	const suggestions = document.createElement('div');
	suggestions.className = 'meeting-scribe-sidebar-speaker-popover-suggestions';
	suggestions.classList.add('meeting-scribe-hidden');
	popover.appendChild(suggestions);

	// Wiki-link checkbox
	const checkboxRow = document.createElement('label');
	checkboxRow.className = 'meeting-scribe-sidebar-speaker-popover-checkbox';

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	// Default to checked for new mappings, preserve state for existing
	checkbox.checked = currentName ? currentWikiLink : true;
	checkboxRow.appendChild(checkbox);

	const checkboxLabel = document.createTextNode(' Create wiki-link');
	checkboxRow.appendChild(checkboxLabel);
	popover.appendChild(checkboxRow);

	// Buttons row
	const actions = document.createElement('div');
	actions.className = 'meeting-scribe-sidebar-speaker-popover-actions';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'meeting-scribe-sidebar-speaker-popover-cancel-btn';
	cancelBtn.textContent = 'Cancel';
	actions.appendChild(cancelBtn);

	const applyBtn = document.createElement('button');
	applyBtn.className = 'meeting-scribe-sidebar-speaker-popover-apply-btn';
	applyBtn.textContent = 'Apply';
	actions.appendChild(applyBtn);

	popover.appendChild(actions);

	return popover;
}

/**
 * Attach interactive behavior to a speaker popover.
 * Wires up input, autocomplete, and button callbacks.
 */
export function attachSpeakerPopoverBehavior(
	popover: HTMLElement,
	callbacks: SpeakerPopoverCallbacks,
): void {
	const input = popover.querySelector('.meeting-scribe-sidebar-speaker-popover-input') as HTMLInputElement;
	const suggestionsEl = popover.querySelector('.meeting-scribe-sidebar-speaker-popover-suggestions') as HTMLElement;
	const cancelBtn = popover.querySelector('.meeting-scribe-sidebar-speaker-popover-cancel-btn') as HTMLElement;
	const applyBtn = popover.querySelector('.meeting-scribe-sidebar-speaker-popover-apply-btn') as HTMLElement;
	const checkbox = popover.querySelector('input[type="checkbox"]') as HTMLInputElement;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Input handler for autocomplete
	input.addEventListener('input', () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			const query = input.value.trim();
			const files = callbacks.getVaultFiles();
			const filtered = filterVaultFiles(files, query, MAX_SUGGESTIONS);
			renderSuggestions(suggestionsEl, filtered, (basename) => {
				input.value = basename;
				suggestionsEl.classList.add('meeting-scribe-hidden');
				input.focus();
			});
		}, 150);
	});

	// Cancel
	cancelBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onCancel();
	});

	// Apply
	applyBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const name = input.value.trim();
		if (!name) return; // Don't apply empty name
		callbacks.onApply(name, checkbox.checked);
	});

	// Enter key to apply
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			const name = input.value.trim();
			if (!name) return;
			callbacks.onApply(name, checkbox.checked);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			callbacks.onCancel();
		}
	});

	// Focus input on open
	setTimeout(() => input.focus(), 0);
}

/**
 * Filter vault markdown files by query prefix.
 */
export function filterVaultFiles(
	files: { basename: string; path: string }[],
	query: string,
	maxResults = MAX_SUGGESTIONS,
): { basename: string; path: string }[] {
	if (!query) return [];
	const lowerQuery = query.toLowerCase();
	const results: { basename: string; path: string }[] = [];
	for (const file of files) {
		if (file.basename.toLowerCase().startsWith(lowerQuery)) {
			results.push(file);
			if (results.length >= maxResults) break;
		}
	}
	return results;
}

/**
 * Update a participant's name and wikiLink in the participants array.
 */
export function updateParticipantMapping(
	participants: ParticipantMapping[],
	alias: string,
	newName: string,
	wikiLink: boolean,
): void {
	const participant = participants.find(p => p.alias === alias);
	if (participant) {
		participant.name = newName;
		participant.wikiLink = wikiLink;
	}
}

/**
 * Format display name — always plain text (wiki-link indicated by icon).
 */
export function formatSpeakerDisplayName(participant: ParticipantMapping, fallbackSpeaker: string): string {
	return participant?.name || fallbackSpeaker;
}

/**
 * Whether this participant has wiki-link enabled.
 */
export function hasWikiLink(participant: ParticipantMapping): boolean {
	return !!(participant?.name && participant.wikiLink);
}

function renderSuggestions(
	container: HTMLElement,
	files: { basename: string; path: string }[],
	onSelect: (basename: string) => void,
): void {
	while (container.firstChild) container.removeChild(container.firstChild);

	if (files.length === 0) {
		container.classList.add('meeting-scribe-hidden');
		return;
	}

	for (const file of files) {
		const item = document.createElement('div');
		item.className = 'meeting-scribe-sidebar-speaker-popover-suggestion';
		item.textContent = file.basename;
		item.addEventListener('click', (e) => {
			e.stopPropagation();
			onSelect(file.basename);
		});
		container.appendChild(item);
	}

	container.classList.remove('meeting-scribe-hidden');
}
