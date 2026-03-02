import type { SlashCommand } from "../../domain/models/chat-session";
import type {
	PickerBadge,
	PickerItem,
	PickerPreview,
	PickerProvider,
	PickerCategory,
} from "./types";
import { CATEGORY_BADGES } from "./types";

interface CommandProviderOptions {
	category: PickerCategory;
	icon: string;
	getCommands: () => SlashCommand[];
	onSelect: (command: SlashCommand) => void;
}

export class CommandPickerProvider implements PickerProvider {
	readonly category: PickerCategory;
	private icon: string;
	private badge: PickerBadge | undefined;
	private getCommands: () => SlashCommand[];
	private onSelect: (command: SlashCommand) => void;

	constructor(options: CommandProviderOptions) {
		this.category = options.category;
		this.icon = options.icon;
		this.badge = CATEGORY_BADGES[options.category];
		this.getCommands = options.getCommands;
		this.onSelect = options.onSelect;
	}

	search(query: string): PickerItem[] {
		const commands = this.getCommands();
		const q = query.toLowerCase();
		const filtered = q
			? commands.filter(
					(cmd) =>
						cmd.name.toLowerCase().includes(q) ||
						(cmd.description &&
							cmd.description.toLowerCase().includes(q)),
				)
			: commands;

		return filtered.map((cmd) => ({
			id: `${this.category}:${cmd.name}`,
			label: `/${cmd.name}`,
			description: cmd.description || undefined,
			icon: this.icon,
			badge: this.badge,
			category: this.category,
			data: cmd,
		}));
	}

	getPreview(item: PickerItem): PickerPreview | null {
		const cmd = item.data as SlashCommand;
		const body = [
			cmd.description || "No description",
			cmd.hint ? `\nUsage: /${cmd.name} ${cmd.hint}` : "",
		]
			.filter(Boolean)
			.join("\n");
		return { title: `/${cmd.name}`, body };
	}

	apply(item: PickerItem): void {
		this.onSelect(item.data as SlashCommand);
	}
}
