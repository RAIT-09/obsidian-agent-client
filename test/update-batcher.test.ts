import { describe, it, expect, beforeEach } from "vitest";
import {
	UpdateBatcher,
	type BatchScheduler,
} from "../src/services/update-batcher";

/** A clock whose frames and timers run only when a test says so */
class ManualScheduler implements BatchScheduler {
	private next = 1;
	frames = new Map<number, () => void>();
	timers = new Map<number, () => void>();

	requestFrame(callback: () => void): number {
		const handle = this.next++;
		this.frames.set(handle, callback);
		return handle;
	}
	cancelFrame(handle: number): void {
		this.frames.delete(handle);
	}
	setTimer(callback: () => void): number {
		const handle = this.next++;
		this.timers.set(handle, callback);
		return handle;
	}
	clearTimer(handle: number): void {
		this.timers.delete(handle);
	}

	runFrames(): void {
		const frames = [...this.frames.values()];
		this.frames.clear();
		for (const frame of frames) frame();
	}
	runTimers(): void {
		const timers = [...this.timers.values()];
		this.timers.clear();
		for (const timer of timers) timer();
	}
}

describe("UpdateBatcher", () => {
	let scheduler: ManualScheduler;
	let applied: string[][];
	let batcher: UpdateBatcher<string>;

	beforeEach(() => {
		scheduler = new ManualScheduler();
		applied = [];
		batcher = new UpdateBatcher<string>(
			(updates) => applied.push(updates),
			scheduler,
		);
	});

	it("applies the updates queued before a frame together, in order", () => {
		batcher.enqueue("a");
		batcher.enqueue("b");
		expect(applied).toEqual([]);
		scheduler.runFrames();
		expect(applied).toEqual([["a", "b"]]);
	});

	it("schedules one frame and one timer per batch", () => {
		batcher.enqueue("a");
		batcher.enqueue("b");
		expect(scheduler.frames.size).toBe(1);
		expect(scheduler.timers.size).toBe(1);
	});

	it("cancels the timer once a frame applied the batch", () => {
		batcher.enqueue("a");
		scheduler.runFrames();
		expect(scheduler.timers.size).toBe(0);
		scheduler.runTimers();
		expect(applied).toEqual([["a"]]);
	});

	it("applies updates on the timer when no frame comes", () => {
		batcher.enqueue("a");
		batcher.enqueue("b");
		scheduler.runTimers();
		expect(applied).toEqual([["a", "b"]]);
		// The frame that never came is cancelled, not left to apply twice
		expect(scheduler.frames.size).toBe(0);
	});

	it("keeps applying batches while frames stay away", () => {
		batcher.enqueue("a");
		scheduler.runTimers();
		batcher.enqueue("b");
		scheduler.runTimers();
		expect(applied).toEqual([["a"], ["b"]]);
	});

	it("applies queued updates at once on flush", () => {
		batcher.enqueue("a");
		batcher.flush();
		expect(applied).toEqual([["a"]]);
		expect(scheduler.frames.size).toBe(0);
		expect(scheduler.timers.size).toBe(0);
	});

	it("does nothing on flush with nothing queued", () => {
		batcher.flush();
		expect(applied).toEqual([]);
	});

	it("drops queued updates on discard and returns them", () => {
		batcher.enqueue("a");
		batcher.enqueue("b");
		expect(batcher.discard()).toEqual(["a", "b"]);
		scheduler.runFrames();
		scheduler.runTimers();
		expect(applied).toEqual([]);
	});

	it("schedules afresh after a discard", () => {
		batcher.enqueue("a");
		batcher.discard();
		batcher.enqueue("b");
		expect(scheduler.frames.size).toBe(1);
		expect(scheduler.timers.size).toBe(1);
		scheduler.runFrames();
		expect(applied).toEqual([["b"]]);
	});
});
