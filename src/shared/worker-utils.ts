/**
 * Worker utility functions for promise-based worker communication.
 */

export interface WorkerMessage<T = unknown> {
	id: string;
	type: string;
	payload: T;
}

export interface WorkerResponse<T = unknown> {
	id: string;
	success: boolean;
	result?: T;
	error?: string;
}

interface PendingRequest<T> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Creates a promise-based wrapper around a Web Worker.
 * Allows async/await style communication with workers.
 */
export class WorkerWrapper<TInput, TOutput> {
	private worker: Worker;
	private pending = new Map<string, PendingRequest<TOutput>>();
	private messageCounter = 0;
	private defaultTimeout: number;

	constructor(worker: Worker, defaultTimeout = 30000) {
		this.worker = worker;
		this.defaultTimeout = defaultTimeout;

		this.worker.onmessage = (
			event: MessageEvent<WorkerResponse<TOutput>>,
		) => {
			const { id, success, result, error } = event.data;
			const request = this.pending.get(id);

			if (request) {
				if (request.timeoutId) {
					clearTimeout(request.timeoutId);
				}
				this.pending.delete(id);

				if (success && result !== undefined) {
					request.resolve(result);
				} else {
					request.reject(new Error(error || "Worker request failed"));
				}
			}
		};

		this.worker.onerror = (event) => {
			// Reject all pending requests on worker error
			const error = new Error(`Worker error: ${event.message}`);
			this.pending.forEach((request) => {
				if (request.timeoutId) {
					clearTimeout(request.timeoutId);
				}
				request.reject(error);
			});
			this.pending.clear();
		};
	}

	/**
	 * Execute a request in the worker and wait for the response.
	 */
	async execute(
		type: string,
		payload: TInput,
		timeout?: number,
	): Promise<TOutput> {
		const id = `${Date.now()}-${++this.messageCounter}`;
		const timeoutMs = timeout ?? this.defaultTimeout;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(`Worker request timed out after ${timeoutMs}ms`),
				);
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timeoutId });

			const message: WorkerMessage<TInput> = { id, type, payload };
			this.worker.postMessage(message);
		});
	}

	/**
	 * Terminate the worker and reject all pending requests.
	 */
	terminate(): void {
		const error = new Error("Worker terminated");
		this.pending.forEach((request) => {
			if (request.timeoutId) {
				clearTimeout(request.timeoutId);
			}
			request.reject(error);
		});
		this.pending.clear();
		this.worker.terminate();
	}

	/**
	 * Check if there are pending requests.
	 */
	get hasPending(): boolean {
		return this.pending.size > 0;
	}
}

/**
 * Creates a worker from a blob URL (for inline workers).
 */
export function createInlineWorker(code: string): Worker {
	const blob = new Blob([code], { type: "application/javascript" });
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url);

	// Clean up the URL after worker is created
	URL.revokeObjectURL(url);

	return worker;
}

/**
 * Simple fuzzy match scoring function.
 * Returns a score where higher is better, or -Infinity if no match.
 */
export function fuzzyMatch(pattern: string, text: string): number {
	if (!pattern || !text) return -Infinity;

	const patternLower = pattern.toLowerCase();
	const textLower = text.toLowerCase();

	// Exact match
	if (textLower === patternLower) return 1000;

	// Starts with
	if (textLower.startsWith(patternLower))
		return 800 + (pattern.length / text.length) * 100;

	// Contains
	if (textLower.includes(patternLower))
		return 500 + (pattern.length / text.length) * 100;

	// Fuzzy character matching
	let patternIdx = 0;
	let score = 0;
	let consecutiveBonus = 0;

	for (
		let i = 0;
		i < textLower.length && patternIdx < patternLower.length;
		i++
	) {
		if (textLower[i] === patternLower[patternIdx]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5;
			patternIdx++;
		} else {
			consecutiveBonus = 0;
		}
	}

	// All pattern characters must match
	if (patternIdx < patternLower.length) return -Infinity;

	return score;
}
