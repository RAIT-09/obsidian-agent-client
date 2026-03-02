export interface PickerItem {
	id: string;
	label: string;
	description?: string;
	icon: string;
	category: PickerCategory;
	/** Whether this item is a navigable category header (like "Files & Folders") */
	isCategory?: boolean;
	/** Whether this item is a "back" button to exit the current category filter */
	isBack?: boolean;
	/** Sub-label shown below the main label (e.g. file path) */
	sublabel?: string;
	/** Badge to show next to the item (e.g. "command", "mcp", "skill") */
	badge?: PickerBadge;
	data: unknown;
}

export interface PickerBadge {
	label: string;
	icon: string;
}

export type PickerCategory =
	| "recent"
	| "file"
	| "folder"
	| "command"
	| "mcp"
	| "skill"
	| "action";

export const CATEGORY_LABELS: Record<PickerCategory, string> = {
	recent: "Recently Used",
	file: "Files",
	folder: "Folders",
	command: "Commands",
	mcp: "MCP Prompts",
	skill: "Skills",
	action: "Actions",
};

export const CATEGORY_ICONS: Record<PickerCategory, string> = {
	recent: "clock",
	file: "file-text",
	folder: "folder",
	command: "terminal",
	mcp: "globe",
	skill: "sparkles",
	action: "zap",
};

export const CATEGORY_BADGES: Partial<Record<PickerCategory, PickerBadge>> = {
	command: { label: "Command", icon: "terminal" },
	mcp: { label: "MCP", icon: "globe" },
	skill: { label: "Skill", icon: "sparkles" },
};

export interface PickerPreview {
	title: string;
	body: string;
	/** Optional tree structure for path/folder previews */
	tree?: PickerTreeNode[];
}

export interface PickerTreeNode {
	name: string;
	icon: string;
	children?: PickerTreeNode[];
}

export interface PickerProvider {
	readonly category: PickerCategory;
	search(query: string): Promise<PickerItem[]> | PickerItem[];
	getPreview?(
		item: PickerItem,
	): Promise<PickerPreview | null> | PickerPreview | null;
	apply(item: PickerItem): void;
}

export type PickerMode = "mention" | "command";
