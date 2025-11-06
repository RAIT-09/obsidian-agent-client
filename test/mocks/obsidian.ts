/**
 * Obsidian API Mock for Testing
 *
 * このファイルは、テスト環境で使用するObsidian APIのモックです。
 * 必要な機能のみを実装し、テストを高速化します。
 */

import { vi } from 'vitest';

// Platform mock
export const Platform = {
	isDesktopApp: true,
	isWin: false,
	isMacOS: true,
	isLinux: false,
	isMobile: false,
	isIosApp: false,
	isAndroidApp: false,
};

// TFile mock
export class TFile {
	path: string;
	basename: string;
	extension: string;
	stat: { ctime: number; mtime: number; size: number };
	name: string;
	parent: unknown;

	constructor(path: string) {
		this.path = path;
		this.basename = path.split('/').pop()?.replace(/\.\w+$/, '') || '';
		this.extension = path.split('.').pop() || '';
		this.name = path.split('/').pop() || '';
		this.stat = {
			ctime: Date.now(),
			mtime: Date.now(),
			size: 1024,
		};
		this.parent = null;
	}
}

// Vault mock
export class Vault {
	private files = new Map<string, string>();

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.has(path) ? new TFile(path) : null;
	}

	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) || '';
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	async write(file: TFile, content: string): Promise<void> {
		this.files.set(file.path, content);
	}

	setMockFile(path: string, content: string) {
		this.files.set(path, content);
	}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.keys())
			.filter((path) => path.endsWith('.md'))
			.map((path) => new TFile(path));
	}

	getFiles(): TFile[] {
		return Array.from(this.files.keys()).map((path) => new TFile(path));
	}

	getAllLoadedFiles(): TFile[] {
		return this.getFiles();
	}
}

// Plugin mock
export class Plugin {
	app: App;
	manifest: PluginManifest;

	constructor() {
		this.app = new App();
		this.manifest = {
			id: 'test-plugin',
			name: 'Test Plugin',
			version: '1.0.0',
			minAppVersion: '0.15.0',
			description: 'Test',
			author: 'Test',
			authorUrl: '',
			isDesktopOnly: false,
		};
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	async saveData(_data: unknown): Promise<void> {
		// Mock implementation
	}

	addRibbonIcon = vi.fn();
	addCommand = vi.fn();
	addSettingTab = vi.fn();
	registerView = vi.fn();
}

// App mock
export class App {
	vault: Vault;
	workspace: Workspace;
	metadataCache: MetadataCache;

	constructor() {
		this.vault = new Vault();
		this.workspace = new Workspace();
		this.metadataCache = new MetadataCache();
	}
}

// Workspace mock
export class Workspace {
	getActiveFile = vi.fn(() => null);
	getActiveViewOfType = vi.fn(() => null);
	getLeavesOfType = vi.fn(() => []);
	getRightLeaf = vi.fn(() => null);
	revealLeaf = vi.fn();
	on = vi.fn(() => ({ unload: vi.fn() } as EventRef));
	offref = vi.fn();
}

// MetadataCache mock
export class MetadataCache {
	private cache = new Map<
		string,
		{ frontmatter?: Record<string, unknown> }
	>();

	getFileCache(file: TFile) {
		return this.cache.get(file.path) || null;
	}

	setMockCache(
		path: string,
		cache: { frontmatter?: Record<string, unknown> },
	) {
		this.cache.set(path, cache);
	}
}

// MarkdownView mock
export class MarkdownView {
	file: TFile | null = null;
	editor = {
		somethingSelected: vi.fn(() => false),
		listSelections: vi.fn(() => []),
		hasFocus: vi.fn(() => true),
		getValue: vi.fn(() => ''),
		setValue: vi.fn(),
		getLine: vi.fn(() => ''),
		lineCount: vi.fn(() => 0),
		getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
	};
}

// Notice mock
export class Notice {
	constructor(message: string) {
		console.log('[Notice]', message);
	}
}

// ItemView mock
export class ItemView {
	containerEl = {
		...document.createElement('div'),
		children: [document.createElement('div')],
	};

	leaf: WorkspaceLeaf | null = null;

	registerDomEvent = vi.fn();
}

// EventRef type
export interface EventRef {
	unload: () => void;
}

// PluginManifest type
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	authorUrl: string;
	isDesktopOnly: boolean;
}

// WorkspaceLeaf mock
export class WorkspaceLeaf {
	view: unknown = null;
	async setViewState(_state: unknown) {
		// Mock implementation
	}
}

// EditorSelection mock
export interface EditorSelection {
	anchor: EditorPosition;
	head?: EditorPosition;
}

// EditorPosition mock
export interface EditorPosition {
	line: number;
	ch: number;
}

// setIcon mock
export const setIcon = vi.fn();

// requestUrl mock
export const requestUrl = vi.fn(async () => ({
	status: 200,
	json: { tag_name: '1.0.0' },
	text: 'mock response',
	arrayBuffer: new ArrayBuffer(0),
	headers: {},
}));
