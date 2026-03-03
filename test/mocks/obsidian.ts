export const Platform = {
	isWin: false,
	isMacOS: false,
	isLinux: true,
};

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export async function requestUrl(_opts: { url: string }): Promise<{
	json: unknown;
}> {
	return { json: {} };
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}

export class FileSystemAdapter {
	private readonly basePath: string;

	constructor(basePath = "") {
		this.basePath = basePath;
	}

	getBasePath(): string {
		return this.basePath;
	}
}

interface DropdownComponent {
	addOption: (value: string, label: string) => DropdownComponent;
	setValue: (value: string) => DropdownComponent;
	onChange: (handler: (value: string) => void) => DropdownComponent;
}

interface ExtraButtonComponent {
	setIcon: (icon: string) => ExtraButtonComponent;
	setTooltip: (tooltip: string) => ExtraButtonComponent;
	onClick: (handler: () => void) => ExtraButtonComponent;
}

export class Setting {
	private readonly root: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.root = containerEl.ownerDocument.createElement("div");
		this.root.className = "setting-item";
		containerEl.appendChild(this.root);
	}

	setName(name: string): this {
		const nameEl = this.root.ownerDocument.createElement("div");
		nameEl.className = "setting-item-name";
		nameEl.textContent = name;
		this.root.appendChild(nameEl);
		return this;
	}

	setDesc(desc: string): this {
		const existing = this.root.querySelector(".setting-item-description");
		if (existing) {
			existing.textContent = desc;
			return this;
		}

		const descEl = this.root.ownerDocument.createElement("div");
		descEl.className = "setting-item-description";
		descEl.textContent = desc;
		this.root.appendChild(descEl);
		return this;
	}

	addExtraButton(callback: (button: ExtraButtonComponent) => void): this {
		const btn = this.root.ownerDocument.createElement("button");
		btn.className = "clickable-icon";
		this.root.appendChild(btn);

		const api: ExtraButtonComponent = {
			setIcon: (icon: string) => {
				btn.setAttribute("data-icon", icon);
				return api;
			},
			setTooltip: (tooltip: string) => {
				btn.setAttribute("aria-label", tooltip);
				return api;
			},
			onClick: (handler: () => void) => {
				btn.addEventListener("click", handler);
				return api;
			},
		};

		callback(api);
		return this;
	}

	addDropdown(callback: (dropdown: DropdownComponent) => void): this {
		const select = this.root.ownerDocument.createElement("select");
		select.className = "dropdown";
		this.root.appendChild(select);

		let changeHandler: ((value: string) => void) | undefined;
		select.addEventListener("change", () => {
			changeHandler?.(select.value);
		});

		const api: DropdownComponent = {
			addOption: (value: string, label: string) => {
				const option = this.root.ownerDocument.createElement("option");
				option.value = value;
				option.textContent = label;
				select.appendChild(option);
				return api;
			},
			setValue: (value: string) => {
				select.value = value;
				return api;
			},
			onChange: (handler: (value: string) => void) => {
				changeHandler = handler;
				return api;
			},
		};

		callback(api);
		return this;
	}
}
