import { App, Modal } from 'obsidian';

export interface DurationGuardAlternative {
	provider: string;
	model: string;
	displayName: string;
	limitMinutes: number | null; // null = unlimited
}

export interface DurationGuardModalOptions {
	durationMinutes: number;
	providerName: string;
	limitMinutes: number;
	alternatives: DurationGuardAlternative[];
}

export interface DurationGuardChoice {
	action: 'split' | 'switch' | 'cancel';
	switchProvider?: string;
	switchModel?: string;
}

export class DurationGuardModal extends Modal {
	private readonly options: DurationGuardModalOptions;
	private resolve?: (value: DurationGuardChoice) => void;
	private resolved = false;

	constructor(app: App, options: DurationGuardModalOptions) {
		super(app);
		this.options = options;
	}

	getResult(): Promise<DurationGuardChoice> {
		return new Promise<DurationGuardChoice>((resolve) => {
			this.resolve = resolve;
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		const { durationMinutes, providerName, limitMinutes, alternatives } = this.options;

		contentEl.createEl('h3', {
			text: 'Audio duration exceeds provider limit',
		});

		contentEl.createEl('p', {
			text: `This audio is approximately ${durationMinutes} minutes. ${providerName} supports up to ${limitMinutes} minutes.`,
		});

		const buttonContainer = contentEl.createEl('div', { cls: 'duration-guard-buttons' });

		// Split button
		const splitBtn = buttonContainer.createEl('button', { text: 'Split into chunks' });
		splitBtn.addEventListener('click', () => {
			this.resolveWith({ action: 'split' });
		});

		// Switch buttons — only show alternatives that can handle the duration
		const viableAlternatives = alternatives.filter(
			a => a.limitMinutes === null || a.limitMinutes >= durationMinutes,
		);
		for (const alt of viableAlternatives) {
			const limitText = alt.limitMinutes === null ? 'no limit' : `up to ${alt.limitMinutes} min`;
			const switchBtn = buttonContainer.createEl('button', {
				text: `Switch to ${alt.displayName} (${limitText})`,
			});
			switchBtn.addEventListener('click', () => {
				this.resolveWith({ action: 'switch', switchProvider: alt.provider, switchModel: alt.model });
			});
		}

		// Cancel button
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.resolveWith({ action: 'cancel' });
		});
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolveWith({ action: 'cancel' });
		}
		this.contentEl.empty();
	}

	private resolveWith(choice: DurationGuardChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve?.(choice);
		this.close();
	}
}
