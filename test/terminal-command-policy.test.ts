import { describe, expect, it } from "vitest";
import {
	extractBaseCommands,
	isDestructiveCommand,
} from "../src/adapters/acp/terminal-command-policy";

describe("terminal-command-policy", () => {
	it("extracts base command from simple command", () => {
		expect(extractBaseCommands("rm notes/a.md")).toEqual(["rm"]);
	});

	it("handles sudo/env wrappers and chained commands", () => {
		expect(
			extractBaseCommands("sudo env FOO=1 /bin/rm a.md && echo done"),
		).toEqual(["rm", "echo"]);
	});

	it("detects destructive command in denylist", () => {
		expect(
			isDestructiveCommand("echo test; /usr/bin/unlink notes/a.md", [
				"rm",
				"unlink",
			]),
		).toBe(true);
	});

	it("does not flag non-destructive command", () => {
		expect(isDestructiveCommand("echo test && ls", ["rm", "del"])).toBe(false);
	});
});
