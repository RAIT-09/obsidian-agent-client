import { TFile, prepareFuzzySearch } from "obsidian";
import type AgentClientPlugin from "../main";

// Note mention service for @-mention functionality
export class NoteMentionService {
	private files: TFile[] = [];
	private lastBuild = 0;
	private plugin: AgentClientPlugin;

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
		this.rebuildIndex();

		// Listen for vault changes to keep index up to date
		this.plugin.app.vault.on("create", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.rebuildIndex();
			}
		});
		this.plugin.app.vault.on("delete", () => this.rebuildIndex());
		this.plugin.app.vault.on("rename", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.rebuildIndex();
			}
		});
	}

	private rebuildIndex() {
		this.files = this.plugin.app.vault.getMarkdownFiles();
		this.lastBuild = Date.now();
		console.log(
			`[NoteMentionService] Rebuilt index with ${this.files.length} files`,
		);
	}

	searchNotes(query: string): TFile[] {
		console.log(
			"[DEBUG] NoteMentionService.searchNotes called with:",
			query,
		);
		console.log("[DEBUG] Total files indexed:", this.files.length);

		if (!query.trim()) {
			console.log("[DEBUG] Empty query, returning recent files");
			// If no query, return recently modified files
			const recentFiles = this.files
				.slice()
				.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
				.slice(0, 5);
			console.log(
				"[DEBUG] Recent files:",
				recentFiles.map((f) => f.name),
			);
			return recentFiles;
		}

		console.log("[DEBUG] Preparing fuzzy search for:", query.trim());
		const fuzzySearch = prepareFuzzySearch(query.trim());

		// Score each file based on multiple fields
		const scored: Array<{ file: TFile; score: number }> = this.files.map(
			(file) => {
				const basename = file.basename;
				const path = file.path;

				// Get aliases from frontmatter
				const fileCache =
					this.plugin.app.metadataCache.getFileCache(file);
				const aliases = fileCache?.frontmatter?.aliases;
				const aliasArray: string[] = Array.isArray(aliases)
					? aliases
					: aliases
						? [aliases]
						: [];

				// Search in basename, path, and aliases
				const searchFields = [basename, path, ...aliasArray];
				let bestScore = -Infinity;

				for (const field of searchFields) {
					const match = fuzzySearch(field);
					if (match && match.score > bestScore) {
						bestScore = match.score;
					}
				}

				return { file, score: bestScore };
			},
		);

		return scored
			.filter((item) => item.score > -Infinity)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map((item) => item.file);
	}

	getAllFiles(): TFile[] {
		return this.files;
	}

	getFileByPath(path: string): TFile | null {
		return this.files.find((file) => file.path === path) || null;
	}
}
