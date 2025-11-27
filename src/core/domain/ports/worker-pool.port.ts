/**
 * Port interface for worker pool operations.
 * Allows use cases to delegate heavy computation to workers
 * without depending on the implementation.
 */

export interface SearchResult {
	path: string;
	basename: string;
	score: number;
}

export interface FileInfo {
	path: string;
	basename: string;
	aliases: string[];
}

/**
 * Interface for search worker operations.
 */
export interface ISearchWorker {
	/**
	 * Perform fuzzy search on indexed files.
	 */
	search(query: string, limit?: number): Promise<SearchResult[]>;

	/**
	 * Update the file index in the worker.
	 */
	updateIndex(files: FileInfo[]): Promise<void>;

	/**
	 * Get the current index size.
	 */
	getIndexSize(): Promise<number>;

	/**
	 * Terminate the worker.
	 */
	terminate(): void;
}

/**
 * Interface for the worker pool.
 */
export interface IWorkerPool {
	/**
	 * Get or create the search worker.
	 */
	getSearchWorker(): ISearchWorker;

	/**
	 * Dispose all workers.
	 */
	dispose(): void;
}
