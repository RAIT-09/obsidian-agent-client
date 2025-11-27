/**
 * Worker pool adapter implementation.
 * Creates and manages Web Workers for heavy computation.
 */

import type {
	IWorkerPool,
	ISearchWorker,
	SearchResult,
	FileInfo,
} from "../../core/domain/ports/worker-pool.port";
import {
	WorkerWrapper,
	createInlineWorker,
	fuzzyMatch,
} from "../../shared/worker-utils";

// Inline search worker code (bundled at build time)
const SEARCH_WORKER_CODE = `
// File metadata stored in the worker
let fileIndex = [];

// Simple fuzzy match
function fuzzyMatch(pattern, text) {
	if (!pattern || !text) return -Infinity;
	const patternLower = pattern.toLowerCase();
	const textLower = text.toLowerCase();
	if (textLower === patternLower) return 1000;
	if (textLower.startsWith(patternLower)) return 800 + (pattern.length / text.length) * 100;
	if (textLower.includes(patternLower)) return 500 + (pattern.length / text.length) * 100;
	let patternIdx = 0;
	let score = 0;
	let consecutiveBonus = 0;
	for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
		if (textLower[i] === patternLower[patternIdx]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5;
			patternIdx++;
		} else {
			consecutiveBonus = 0;
		}
	}
	if (patternIdx < patternLower.length) return -Infinity;
	return score;
}

function performSearch(query, limit = 10) {
	if (!query.trim()) {
		return fileIndex.slice(0, limit).map(f => ({
			path: f.path,
			basename: f.basename,
			score: 0,
		}));
	}
	const results = [];
	for (const file of fileIndex) {
		let bestScore = fuzzyMatch(query, file.basename);
		for (const alias of file.aliases || []) {
			const aliasScore = fuzzyMatch(query, alias);
			if (aliasScore > bestScore) bestScore = aliasScore;
		}
		const pathScore = fuzzyMatch(query, file.path) * 0.5;
		if (pathScore > bestScore) bestScore = pathScore;
		if (bestScore > -Infinity) {
			results.push({ path: file.path, basename: file.basename, score: bestScore });
		}
	}
	results.sort((a, b) => b.score - a.score);
	return results.slice(0, limit);
}

self.onmessage = function(event) {
	const { id, type, payload } = event.data;
	try {
		let result;
		switch (type) {
			case "search":
				result = performSearch(payload.query, payload.limit);
				break;
			case "updateIndex":
				fileIndex = payload.files;
				result = { indexed: fileIndex.length };
				break;
			case "getIndexSize":
				result = { size: fileIndex.length };
				break;
			default:
				throw new Error("Unknown message type: " + type);
		}
		self.postMessage({ id, success: true, result });
	} catch (error) {
		self.postMessage({ id, success: false, error: error.message || String(error) });
	}
};
`;

/**
 * Search worker implementation using inline worker.
 */
class SearchWorkerAdapter implements ISearchWorker {
	private worker: WorkerWrapper<unknown, unknown> | null = null;
	private initPromise: Promise<void> | null = null;

	constructor() {
		this.initPromise = this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			const rawWorker = createInlineWorker(SEARCH_WORKER_CODE);
			this.worker = new WorkerWrapper(rawWorker);
		} catch (error) {
			console.warn(
				"[SearchWorkerAdapter] Failed to create worker, will use main thread:",
				error,
			);
			this.worker = null;
		}
	}

	async search(query: string, limit = 10): Promise<SearchResult[]> {
		await this.initPromise;

		if (!this.worker) {
			// Fallback: return empty (main thread will handle)
			return [];
		}

		try {
			const result = await this.worker.execute("search", {
				query,
				limit,
			});
			return result as SearchResult[];
		} catch (error) {
			console.warn("[SearchWorkerAdapter] Search failed:", error);
			return [];
		}
	}

	async updateIndex(files: FileInfo[]): Promise<void> {
		await this.initPromise;

		if (!this.worker) return;

		try {
			await this.worker.execute("updateIndex", { files });
		} catch (error) {
			console.warn("[SearchWorkerAdapter] Index update failed:", error);
		}
	}

	async getIndexSize(): Promise<number> {
		await this.initPromise;

		if (!this.worker) return 0;

		try {
			const result = (await this.worker.execute("getIndexSize", {})) as {
				size: number;
			};
			return result.size;
		} catch {
			return 0;
		}
	}

	terminate(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}
}

/**
 * Main thread fallback for search when workers are unavailable.
 * Used when Web Workers can't be created.
 */
export class MainThreadSearchAdapter implements ISearchWorker {
	private files: FileInfo[] = [];

	async search(query: string, limit = 10): Promise<SearchResult[]> {
		if (!query.trim()) {
			return this.files.slice(0, limit).map((f) => ({
				path: f.path,
				basename: f.basename,
				score: 0,
			}));
		}

		const results: SearchResult[] = [];

		for (const file of this.files) {
			let bestScore = fuzzyMatch(query, file.basename);

			for (const alias of file.aliases || []) {
				const aliasScore = fuzzyMatch(query, alias);
				if (aliasScore > bestScore) {
					bestScore = aliasScore;
				}
			}

			const pathScore = fuzzyMatch(query, file.path) * 0.5;
			if (pathScore > bestScore) {
				bestScore = pathScore;
			}

			if (bestScore > -Infinity) {
				results.push({
					path: file.path,
					basename: file.basename,
					score: bestScore,
				});
			}
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	}

	async updateIndex(files: FileInfo[]): Promise<void> {
		this.files = files;
	}

	async getIndexSize(): Promise<number> {
		return this.files.length;
	}

	terminate(): void {
		this.files = [];
	}
}

/**
 * Worker pool implementation.
 */
export class WorkerPoolAdapter implements IWorkerPool {
	private searchWorker: ISearchWorker | null = null;
	private useWorkers: boolean;

	constructor(useWorkers = true) {
		this.useWorkers = useWorkers && typeof Worker !== "undefined";
	}

	getSearchWorker(): ISearchWorker {
		if (!this.searchWorker) {
			if (this.useWorkers) {
				try {
					this.searchWorker = new SearchWorkerAdapter();
				} catch {
					// Fallback to main thread
					this.searchWorker = new MainThreadSearchAdapter();
				}
			} else {
				this.searchWorker = new MainThreadSearchAdapter();
			}
		}
		return this.searchWorker;
	}

	dispose(): void {
		if (this.searchWorker) {
			this.searchWorker.terminate();
			this.searchWorker = null;
		}
	}
}
