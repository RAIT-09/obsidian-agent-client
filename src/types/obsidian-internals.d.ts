export {};

/**
 * Type augmentation for unofficial Obsidian APIs.
 *
 * These methods exist at runtime but are not in the public type definitions.
 * Only add methods that are widely used by the plugin community and unlikely
 * to be removed without notice.
 */
declare module "obsidian" {
	interface Vault {
		getConfig(key: string): unknown;
	}

	interface App {
		/**
		 * Coordinator for Obsidian-internal drag and drop (file explorer,
		 * search results, links, tabs, ...). Optional because it is
		 * unofficial; callers must tolerate its absence.
		 */
		dragManager?: DragManager;
	}

	interface DragManager {
		/**
		 * Payload of the in-progress internal drag, or null. Set on
		 * dragstart and cleared on dragend, so it is still readable inside
		 * a drop handler.
		 */
		draggable: Draggable | null;
	}

	/**
	 * Internal drag payload. Shapes observed in Obsidian 1.15:
	 * - `{ type: "file", file: TFile }` — single file (explorer, search, ...)
	 * - `{ type: "files", files: (TFile | TFolder)[] }` — explorer multi-select
	 * - `{ type: "folder", file: TFolder }`
	 * - `{ type: "link", file: TFile | null, linktext: string }`
	 * Fields are typed loosely so callers narrow at runtime.
	 */
	interface Draggable {
		type: string;
		file?: TAbstractFile | null;
		files?: TAbstractFile[];
	}
}
