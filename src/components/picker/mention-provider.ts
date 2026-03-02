import type {
	IVaultAccess,
	NoteMetadata,
} from "../../domain/ports/vault-access.port";
import type {
	PickerItem,
	PickerPreview,
	PickerProvider,
	PickerTreeNode,
} from "./types";

function iconForExtension(ext: string): string {
	switch (ext) {
		case "md":
			return "file-text";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "webp":
		case "svg":
			return "image";
		case "pdf":
			return "file-type";
		case "canvas":
			return "layout-dashboard";
		case "excalidraw":
			return "pencil-ruler";
		case "json":
		case "yaml":
		case "yml":
		case "toml":
			return "file-code";
		case "js":
		case "ts":
		case "tsx":
		case "jsx":
		case "css":
			return "file-code-2";
		default:
			return "file";
	}
}

function buildPathTree(
	fullPath: string,
	fileIcon: string,
): PickerTreeNode[] {
	const parts = fullPath.split("/");
	if (parts.length === 1) {
		return [{ name: parts[0], icon: fileIcon }];
	}

	let current: PickerTreeNode = {
		name: parts[parts.length - 1],
		icon: fileIcon,
	};

	for (let i = parts.length - 2; i >= 0; i--) {
		current = {
			name: parts[i],
			icon: "folder",
			children: [current],
		};
	}

	return [current];
}

export class FilePickerProvider implements PickerProvider {
	readonly category = "file" as const;

	private searchTimer: ReturnType<typeof setTimeout> | null = null;
	private abortController: AbortController | null = null;

	constructor(
		private vaultAccess: IVaultAccess,
		private onSelect: (note: NoteMetadata) => void,
	) {}

	async search(query: string): Promise<PickerItem[]> {
		if (this.searchTimer) clearTimeout(this.searchTimer);
		if (this.abortController) this.abortController.abort();

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		const results = await new Promise<NoteMetadata[]>((resolve) => {
			this.searchTimer = setTimeout(() => {
				if (signal.aborted) {
					resolve([]);
					return;
				}
				this.vaultAccess.searchNotes(query).then(
					(notes) => {
						resolve(signal.aborted ? [] : notes);
					},
					() => {
						resolve([]);
					},
				);
			}, 80);
		});

		return results.map((note) => {
			const parentDir = note.path.includes("/")
				? note.path.slice(0, note.path.lastIndexOf("/"))
				: "";
			const label =
				note.extension.toLowerCase() === "md"
					? note.name
					: `${note.name}.${note.extension}`;
			return {
				id: `file:${note.path}`,
				label,
				sublabel: parentDir || "/",
				icon: iconForExtension(note.extension),
				category: "file" as const,
				data: note,
			};
		});
	}

	getPreview(item: PickerItem): PickerPreview | null {
		const note = item.data as NoteMetadata;
		const fileIcon = iconForExtension(note.extension);
		return {
			title: note.path,
			body: "",
			tree: buildPathTree(note.path, fileIcon),
		};
	}

	apply(item: PickerItem): void {
		this.onSelect(item.data as NoteMetadata);
	}

	destroy(): void {
		if (this.searchTimer) clearTimeout(this.searchTimer);
		if (this.abortController) this.abortController.abort();
	}
}

export class FolderPickerProvider implements PickerProvider {
	readonly category = "folder" as const;

	constructor(
		private getFolders: () => string[],
		private onSelect: (folderPath: string) => void,
	) {}

	search(query: string): PickerItem[] {
		const folders = this.getFolders();
		const q = query.toLowerCase();
		const filtered = q
			? folders.filter((f) => f.toLowerCase().includes(q))
			: folders.slice(0, 15);

		return filtered.map((folder) => {
			const parts = folder.split("/");
			const parentDir =
				parts.length > 1 ? parts.slice(0, -1).join("/") : "/";
			return {
				id: `folder:${folder}`,
				label: parts[parts.length - 1] || folder,
				sublabel: parentDir,
				icon: "folder",
				category: "folder" as const,
				data: folder,
			};
		});
	}

	getPreview(item: PickerItem): PickerPreview | null {
		const folderPath = item.data as string;
		return {
			title: folderPath,
			body: "",
			tree: buildPathTree(folderPath + "/", "folder"),
		};
	}

	apply(item: PickerItem): void {
		this.onSelect(item.data as string);
	}
}
