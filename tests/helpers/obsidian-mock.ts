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
	if (!HTMLElement.prototype.addClass) {
		HTMLElement.prototype.addClass = function (...classes: string[]) {
			this.classList.add(...classes);
		};
	}
	if (!HTMLElement.prototype.removeClass) {
		HTMLElement.prototype.removeClass = function (...classes: string[]) {
			this.classList.remove(...classes);
		};
	}
	if (!HTMLElement.prototype.createDiv) {
		HTMLElement.prototype.createDiv = function (
			o?: { cls?: string; text?: string; attr?: Record<string, string> },
		): HTMLDivElement {
			const el = document.createElement('div');
			if (o?.cls) el.className = o.cls;
			if (o?.text) el.textContent = o.text;
			if (o?.attr) {
				for (const [k, v] of Object.entries(o.attr)) {
					el.setAttribute(k, v);
				}
			}
			this.appendChild(el);
			return el;
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
		createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;
		createEl(tag: string, o?: { text?: string; cls?: string; attr?: Record<string, string> }): HTMLElement;
		addClass(...classes: string[]): void;
		removeClass(...classes: string[]): void;
	}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
}

export function setIcon(el: HTMLElement, iconId: string): void {
	el.dataset.icon = iconId;
	el.empty();
	const iconEl = document.createElement('svg');
	iconEl.setAttribute('data-icon', iconId);
	el.appendChild(iconEl);
}

export class Plugin {
	app: unknown = {
		workspace: {
			onLayoutReady: (cb: () => void) => { cb(); },
			openLinkText: async () => {},
			getRightLeaf: () => ({
				setViewState: async () => {},
			}),
			getLeavesOfType: () => [],
			detachLeavesOfType: () => {},
			revealLeaf: async () => {},
			on: () => ({ id: 'mock-event' }),
		},
		vault: new Vault(),
		fileManager: new FileManager(),
		setting: {
			open: () => {},
			openTabById: () => {},
		},
	};
	manifest: unknown = {};
	commands: { id: string; name: string; callback: () => void }[] = [];
	registeredViews: Map<string, (leaf: WorkspaceLeaf) => ItemView> = new Map();
	async loadData(): Promise<unknown> { return null; }
	async saveData(_data: unknown): Promise<void> { /* noop */ }
	addRibbonIcon() { return document.createElement('div'); }
	addStatusBarItem() { return document.createElement('div'); }
	addCommand(command: { id: string; name: string; callback: () => void }) {
		this.commands.push(command);
		return command;
	}
	addSettingTab() { /* noop */ }
	registerView(type: string, factory: (leaf: WorkspaceLeaf) => ItemView) {
		this.registeredViews.set(type, factory);
	}
	registerDomEvent() { /* noop */ }
	registerEvent() { /* noop */ }
	registerInterval() { return 0; }
}

export class Notice {
	noticeEl: HTMLElement;
	timeout?: number;

	constructor(message: string | DocumentFragment, timeout?: number) {
		this.timeout = timeout;
		this.noticeEl = document.createElement('div');
		this.noticeEl.className = 'notice';
		if (typeof message === 'string') {
			this.noticeEl.textContent = message;
		} else if (message instanceof DocumentFragment) {
			this.noticeEl.appendChild(message);
		}
	}

	hide(): void { /* noop */ }

	setMessage(message: string | DocumentFragment): this {
		if (typeof message === 'string') {
			this.noticeEl.textContent = message;
		}
		return this;
	}
}

export class FileManager {
	async trashFile(_file: TFile): Promise<void> { /* noop */ }
}

export type App = Record<string, unknown>;

export class Vault {
	async create(_path: string, _data: string): Promise<TFile> { return new TFile(_path); }
	async createBinary(_path: string, _data: ArrayBuffer): Promise<TFile> { return new TFile(_path); }
	async read(_file: TFile): Promise<string> { return ''; }
	async readBinary(_file: TFile): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
	async modify(_file: TFile, _data: string): Promise<void> { /* noop */ }
	getAbstractFileByPath(_path: string): TFile | null { return null; }
	async delete(_file: TFile): Promise<void> { /* noop */ }
	async createFolder(_path: string): Promise<unknown> { return {}; }
	getFiles(): TFile[] { return []; }
}

export type TFolder = Record<string, unknown>;
export type TAbstractFile = Record<string, unknown>;

export class TFile {
	path: string;
	name: string;
	extension: string;
	stat: { size: number; ctime: number; mtime: number };

	constructor(path: string, size = 1024) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
		this.extension = this.name.split('.').pop() ?? '';
		this.stat = { size, ctime: Date.now(), mtime: Date.now() };
	}
}

export class Modal {
	app: App;
	contentEl: HTMLElement;
	modalEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.contentEl = document.createElement('div');
		this.modalEl = document.createElement('div');
	}

	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
}

export class SuggestModal<T> {
	app: App;
	emptyStateText = '';
	containerEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.containerEl = document.createElement('div');
	}

	setPlaceholder(_text: string): void {}
	open(): void {}
	close(): void {}
	getSuggestions(_query: string): T[] { return []; }
	renderSuggestion(_item: T, _el: HTMLElement): void {}
	onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

export class WorkspaceLeaf {
	view: unknown = null;
	containerEl: HTMLElement;

	constructor() {
		this.containerEl = document.createElement('div');
	}
}

export class ItemView {
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;
	contentEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		this.leaf = leaf;
		this.containerEl = leaf.containerEl;
		this.contentEl = document.createElement('div');
		this.containerEl.appendChild(this.contentEl);
	}

	getViewType(): string { return ''; }
	getDisplayText(): string { return ''; }
	getIcon(): string { return 'document'; }
	async onOpen(): Promise<void> { /* override */ }
	async onClose(): Promise<void> { /* override */ }
}

export const Platform = {
	isMobile: false,
	isDesktop: true,
	isDesktopApp: true,
};

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

export class ButtonComponent {
	buttonEl: HTMLButtonElement = document.createElement('button');
	private _onClick?: (evt: MouseEvent) => void;
	private _text = '';

	setButtonText(text: string): this { this._text = text; this.buttonEl.textContent = text; return this; }
	getButtonText(): string { return this._text; }
	setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
	setCta(): this { return this; }
	setWarning(): this { return this; }
	onClick(cb: (evt: MouseEvent) => void): this { this._onClick = cb; return this; }
	triggerClick(): void { if (this._onClick) this._onClick(new MouseEvent('click')); }
}

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
}

export const requestUrl = vi.fn<(request: RequestUrlParam | string) => Promise<RequestUrlResponse>>();

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	private _name = '';
	private _heading = false;
	textComponents: TextComponent[] = [];
	dropdownComponents: DropdownComponent[] = [];
	toggleComponents: ToggleComponent[] = [];
	buttonComponents: ButtonComponent[] = [];

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement('div');
		this.nameEl = document.createElement('div');
		this.descEl = document.createElement('div');
		(this.settingEl as unknown as { _settingInstance: Setting })._settingInstance = this;
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string): this { this._name = name; this.nameEl.textContent = name; return this; }
	getName(): string { return this._name; }
	setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
	getDesc(): string { return this.descEl.textContent ?? ''; }
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

	addButton(cb: (button: ButtonComponent) => void): this {
		const button = new ButtonComponent();
		this.buttonComponents.push(button);
		cb(button);
		return this;
	}
}
