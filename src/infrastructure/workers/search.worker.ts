/**
 * Web Worker for fuzzy search operations.
 * Runs searches off the main thread to prevent UI jank.
 */

import type { WorkerMessage, WorkerResponse } from "../../shared/worker-utils";
import { fuzzyMatch } from "../../shared/worker-utils";

// File metadata stored in the worker
interface FileInfo {
	path: string;
	basename: string;
	aliases: string[];
}

interface SearchRequest {
	query: string;
	limit?: number;
}

interface SearchResult {
	path: string;
	basename: string;
	score: number;
}

interface IndexRequest {
	files: FileInfo[];
}

// Worker state
let fileIndex: FileInfo[] = [];

/**
 * Perform fuzzy search on the file index.
 */
function performSearch(query: string, limit: number = 10): SearchResult[] {
	if (!query.trim()) {
		// Return most recent files (assuming index order)
		return fileIndex.slice(0, limit).map((f) => ({
			path: f.path,
			basename: f.basename,
			score: 0,
		}));
	}

	const results: SearchResult[] = [];

	for (const file of fileIndex) {
		// Score against basename (primary)
		let bestScore = fuzzyMatch(query, file.basename);

		// Also check aliases
		for (const alias of file.aliases) {
			const aliasScore = fuzzyMatch(query, alias);
			if (aliasScore > bestScore) {
				bestScore = aliasScore;
			}
		}

		// Also check full path (lower weight)
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

	// Sort by score descending and limit
	results.sort((a, b) => b.score - a.score);
	return results.slice(0, limit);
}

/**
 * Update the file index.
 */
function updateIndex(files: FileInfo[]): void {
	fileIndex = files;
}

// Message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	const { id, type, payload } = event.data;

	try {
		let result: unknown;

		switch (type) {
			case "search": {
				const { query, limit } = payload as SearchRequest;
				result = performSearch(query, limit);
				break;
			}

			case "updateIndex": {
				const { files } = payload as IndexRequest;
				updateIndex(files);
				result = { indexed: files.length };
				break;
			}

			case "getIndexSize": {
				result = { size: fileIndex.length };
				break;
			}

			default:
				throw new Error(`Unknown message type: ${type}`);
		}

		const response: WorkerResponse = {
			id,
			success: true,
			result,
		};
		self.postMessage(response);
	} catch (error) {
		const response: WorkerResponse = {
			id,
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
		self.postMessage(response);
	}
};

// Signal worker is ready
self.postMessage({ type: "ready" });
