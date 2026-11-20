import { describe, it, expect } from "vitest";
import { stdoutStream, type DataEvents } from "../src/acp/acp-client";

/** A stand-in for the agent's stdout */
function fakeStdout() {
	const listeners = new Map<string, Set<(chunk: Uint8Array) => void>>();
	const of = (event: string) => {
		let set = listeners.get(event);
		if (!set) listeners.set(event, (set = new Set()));
		return set;
	};
	const stdout: DataEvents = {
		on: (event, listener) => of(event).add(listener),
		off: (event, listener) => of(event).delete(listener),
	};
	return {
		stdout,
		emit: (event: string, chunk = new Uint8Array()) => {
			for (const listener of of(event)) listener(chunk);
		},
		listenerCount: (event: string) => of(event).size,
	};
}

describe("stdoutStream", () => {
	it("passes stdout on until the reader cancels, then stops reading it", async () => {
		const { stdout, emit, listenerCount } = fakeStdout();
		const reasons: unknown[] = [];
		const reader = stdoutStream(stdout, (reason) =>
			reasons.push(reason),
		).getReader();
		emit("data", new Uint8Array([1]));
		expect((await reader.read()).value).toEqual(new Uint8Array([1]));

		await reader.cancel("too large");
		expect(reasons).toEqual(["too large"]);
		expect(listenerCount("data")).toBe(0);
		expect(listenerCount("end")).toBe(0);
		// Enqueueing into the cancelled stream would throw here
		expect(() => {
			emit("data", new Uint8Array([2]));
			emit("end");
		}).not.toThrow();
	});
});
