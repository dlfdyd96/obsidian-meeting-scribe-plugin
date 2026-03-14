// Mock for the 'obsidian' module which is provided at runtime by the Obsidian app.
// This file is aliased in vitest.config.ts so that imports of 'obsidian' resolve here during tests.

// Obsidian adds custom methods to HTMLElement prototype
if (typeof HTMLElement !== 'undefined') {
	if (!HTMLElement.prototype.empty) {
		HTMLElement.prototype.empty = function () {
			while (this.firstChild) {
				this.removeChild(this.firstChild);
			}
		};
	}
	if (!HTMLElement.prototype.createEl) {
		HTMLElement.prototype.createEl = function (
			tag: string,
			o?: { text?: string; cls?: string; attr?: Record<string, string> },
		): HTMLElement {
			const el = document.createElement(tag);
			if (o?.text) el.textContent = o.text;
			if (o?.cls) el.className = o.cls;
			if (o?.attr) {
				for (const [k, v] of Object.entries(o.attr)) {
					el.setAttribute(k, v);
				}
			}
			this.appendChild(el);
			return el;
		};
	}
}

declare global {
	interface HTMLElement {
		empty(): void;
		createEl(tag: string, o?: { text?: string; cls?: string; attr?: Record<string, string> }): HTMLElement;
	}
}

export class Plugin {
	app: unknown = {};
	manifest: unknown = {};
	async loadData(): Promise<unknown> { return null; }
	async saveData(_data: unknown): Promise<void> { /* noop */ }
	addRibbonIcon() { return document.createElement('div'); }
	addStatusBarItem() { return document.createElement('div'); }
	addCommand() { return null; }
	addSettingTab() { /* noop */ }
	registerDomEvent() { /* noop */ }
	registerInterval() { return 0; }
}

export class Notice {
	constructor(_message: string) { /* noop */ }
}

export type App = Record<string, unknown>;

export class PluginSettingTab {
	app: App;
	containerEl: HTMLElement;

	constructor(app: App, _plugin: Plugin) {
		this.app = app;
		this.containerEl = document.createElement('div');
	}

	display(): void { /* override in subclass */ }
	hide(): void { /* noop */ }
}

class TextComponent {
	inputEl: HTMLInputElement = document.createElement('input');
	private _value = '';
	private _onChange?: (value: string) => void;

	setPlaceholder(_placeholder: string): this { return this; }
	setValue(value: string): this { this._value = value; this.inputEl.value = value; return this; }
	getValue(): string { return this._value; }
	onChange(cb: (value: string) => void): this { this._onChange = cb; return this; }
	triggerChange(value: string): void { if (this._onChange) this._onChange(value); }
}

class DropdownComponent {
	selectEl: HTMLSelectElement = document.createElement('select');
	private _value = '';
	private _onChange?: (value: string) => void;
	private _options: Record<string, string> = {};

	addOption(value: string, display: string): this { this._options[value] = display; return this; }
	addOptions(options: Record<string, string>): this { Object.assign(this._options, options); return this; }
	setValue(value: string): this { this._value = value; return this; }
	getValue(): string { return this._value; }
	onChange(cb: (value: string) => void): this { this._onChange = cb; return this; }
	triggerChange(value: string): void { if (this._onChange) this._onChange(value); }
	getOptions(): Record<string, string> { return this._options; }
}

class ToggleComponent {
	toggleEl: HTMLElement = document.createElement('div');
	private _value = false;
	private _onChange?: (value: boolean) => void;

	setValue(value: boolean): this { this._value = value; return this; }
	getValue(): boolean { return this._value; }
	onChange(cb: (value: boolean) => void): this { this._onChange = cb; return this; }
	triggerChange(value: boolean): void { if (this._onChange) this._onChange(value); }
}

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	private _name = '';
	private _heading = false;
	textComponents: TextComponent[] = [];
	dropdownComponents: DropdownComponent[] = [];
	toggleComponents: ToggleComponent[] = [];

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement('div');
		this.nameEl = document.createElement('div');
		this.descEl = document.createElement('div');
		(this.settingEl as unknown as { _settingInstance: Setting })._settingInstance = this;
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string): this { this._name = name; this.nameEl.textContent = name; return this; }
	getName(): string { return this._name; }
	setDesc(_desc: string): this { return this; }
	setHeading(): this { this._heading = true; return this; }
	isHeading(): boolean { return this._heading; }

	addText(cb: (text: TextComponent) => void): this {
		const text = new TextComponent();
		this.textComponents.push(text);
		cb(text);
		return this;
	}

	addDropdown(cb: (dropdown: DropdownComponent) => void): this {
		const dropdown = new DropdownComponent();
		this.dropdownComponents.push(dropdown);
		cb(dropdown);
		return this;
	}

	addToggle(cb: (toggle: ToggleComponent) => void): this {
		const toggle = new ToggleComponent();
		this.toggleComponents.push(toggle);
		cb(toggle);
		return this;
	}
}
