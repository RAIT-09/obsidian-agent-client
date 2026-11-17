/**
 * Batches streaming updates so they are applied once per frame rather than
 * once per chunk.
 *
 * Animation frames are the natural tick for this, but they stop whenever the
 * window isn't drawn (minimized, behind other windows, display off), and an
 * agent can finish whole turns, or wait on a permission request, without a
 * single frame. A timer backs the frame up so queued updates still get
 * applied (background windows throttle timers, but don't stop them), and
 * `flush()` applies them right away where waiting isn't an option, such as
 * at the end of a turn.
 */

/** The clock a batcher runs on (the window's, unless a test passes its own) */
export interface BatchScheduler {
	requestFrame(callback: () => void): number;
	cancelFrame(handle: number): void;
	setTimer(callback: () => void, ms: number): number;
	clearTimer(handle: number): void;
}

// Looked up at call time, not bound once, so the window's current functions
// are used
const windowScheduler: BatchScheduler = {
	requestFrame: (callback) => window.requestAnimationFrame(callback),
	cancelFrame: (handle) => window.cancelAnimationFrame(handle),
	setTimer: (callback, ms) => window.setTimeout(callback, ms),
	clearTimer: (handle) => window.clearTimeout(handle),
};

/**
 * How long queued updates wait for a frame before the timer applies them.
 * A drawn window gets a frame well within this.
 */
export const FRAME_FALLBACK_MS = 250;

export class UpdateBatcher<T> {
	private queue: T[] = [];
	private frame: number | null = null;
	private timer: number | null = null;

	/**
	 * @param apply - Applies queued updates, oldest first. Only called with
	 * at least one update.
	 */
	constructor(
		private readonly apply: (updates: T[]) => void,
		private readonly scheduler: BatchScheduler = windowScheduler,
		private readonly fallbackMs: number = FRAME_FALLBACK_MS,
	) {}

	/** Queue an update for the next frame (or the fallback timer) */
	enqueue(update: T): void {
		this.queue.push(update);
		if (this.frame === null) {
			this.frame = this.scheduler.requestFrame(() => {
				this.frame = null;
				this.flush();
			});
		}
		if (this.timer === null) {
			this.timer = this.scheduler.setTimer(() => {
				this.timer = null;
				this.flush();
			}, this.fallbackMs);
		}
	}

	/** Apply queued updates now */
	flush(): void {
		const updates = this.discard();
		if (updates.length > 0) this.apply(updates);
	}

	/**
	 * Drop queued updates without applying them
	 *
	 * @returns The dropped updates, oldest first
	 */
	discard(): T[] {
		this.cancelScheduled();
		const updates = this.queue;
		this.queue = [];
		return updates;
	}

	private cancelScheduled(): void {
		if (this.frame !== null) {
			this.scheduler.cancelFrame(this.frame);
			this.frame = null;
		}
		if (this.timer !== null) {
			this.scheduler.clearTimer(this.timer);
			this.timer = null;
		}
	}
}
