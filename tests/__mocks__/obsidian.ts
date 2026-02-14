// Minimal Obsidian API stubs for testing
// This file is aliased in vitest.config.ts

export class Plugin {}

export class ItemView {
	contentEl = document.createElement("div");
}

export const Platform = {
	isDesktopApp: true,
	isMacOS: true,
	isWin: false,
	isLinux: false,
};

export class TFile {
	path = "";
	basename = "";
	extension = "md";
}

export class Notice {
	constructor(_message: string) {}
}

export class Modal {}
export class Setting {}

export class Menu {
	addItem(_cb: unknown) {
		return this;
	}
	showAtPosition(_pos: unknown) {}
}

export class WorkspaceLeaf {}

export function setIcon(_el: HTMLElement, _iconName: string) {}
