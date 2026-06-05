import { describe, it, expect, beforeEach } from "vitest";
import { Platform } from "obsidian";
import {
	convertWindowsPathToWsl,
	convertWslPathToWindows,
	escapeShellArgBash,
	escapeShellArgWindows,
	buildWslArgvScript,
	wrapCommandForWsl,
	prepareShellCommand,
	buildWslEnv,
	isSameDirectory,
} from "../src/utils/platform";

const WSL_EXE = "C:\\Windows\\System32\\wsl.exe";

function resetPlatform(): void {
	Platform.isWin = false;
	Platform.isMacOS = false;
	Platform.isLinux = false;
	Platform.isDesktopApp = true;
}

beforeEach(resetPlatform);

describe("convertWindowsPathToWsl", () => {
	it("converts a Windows drive path", () => {
		expect(convertWindowsPathToWsl("C:\\Users\\me")).toBe("/mnt/c/Users/me");
	});
	it("lowercases the drive letter and normalizes slashes", () => {
		expect(convertWindowsPathToWsl("D:/Foo/Bar")).toBe("/mnt/d/Foo/Bar");
	});
	it("is idempotent on already-WSL paths", () => {
		expect(convertWindowsPathToWsl("/mnt/c/x")).toBe("/mnt/c/x");
	});
	it("passes through non-drive paths unchanged", () => {
		expect(convertWindowsPathToWsl("relative/dir")).toBe("relative/dir");
	});
});

describe("convertWslPathToWindows", () => {
	it("converts a /mnt path", () => {
		expect(convertWslPathToWindows("/mnt/c/Users/me")).toBe("C:\\Users\\me");
	});
	it("passes through non-/mnt paths unchanged", () => {
		expect(convertWslPathToWindows("/home/me")).toBe("/home/me");
	});
	it("round-trips with convertWindowsPathToWsl", () => {
		const win = "C:\\Users\\me\\vault";
		expect(convertWslPathToWindows(convertWindowsPathToWsl(win))).toBe(win);
	});
});

describe("escapeShellArgBash", () => {
	it("wraps plain args in single quotes", () => {
		expect(escapeShellArgBash("foo")).toBe("'foo'");
	});
	it("preserves spaces inside quotes", () => {
		expect(escapeShellArgBash("foo bar")).toBe("'foo bar'");
	});
	it("escapes embedded single quotes", () => {
		expect(escapeShellArgBash("it's")).toBe("'it'\\''s'");
	});
});

describe("escapeShellArgWindows", () => {
	it("leaves simple args unquoted", () => {
		expect(escapeShellArgWindows("foo")).toBe("foo");
	});
	it("quotes args with spaces", () => {
		expect(escapeShellArgWindows("foo bar")).toBe('"foo bar"');
	});
	it("doubles percent signs", () => {
		expect(escapeShellArgWindows("%PATH%")).toBe("%%PATH%%");
	});
});

describe("buildWslArgvScript", () => {
	const script = buildWslArgvScript();
	it("runs a login shell so ~/.profile is sourced (env preserved)", () => {
		expect(script).toContain(" -l ");
	});
	it("execs the forwarded argv", () => {
		expect(script).toContain('exec "$@"');
	});
	it("references $SHELL directly with a /bin/sh fallback", () => {
		expect(script).toContain("${SHELL:-/bin/sh}");
		expect(script).toContain("*/fish");
	});
	it("does not bake in any command/args (pure constant)", () => {
		// Sanity: the script must not contain a placeholder that implies
		// string interpolation of user data.
		expect(script).not.toContain("undefined");
	});
});

describe("wrapCommandForWsl — agent (useArgvExec)", () => {
	it("uses --exec + /bin/sh -c <script>, forwarding command/args as ordered argv", () => {
		const { command, args } = wrapCommandForWsl(
			"/home/u/agent",
			["acp"],
			"C:\\vault",
			undefined,
			undefined,
			true,
		);
		expect(command).toBe(WSL_EXE);
		// header: --exec /bin/sh -c <launcher script>
		expect(args.slice(0, 3)).toEqual(["--exec", "/bin/sh", "-c"]);
		// launcher keeps a login shell so the environment is preserved
		expect(args[3]).toContain(" -l ");
		// positionals: sh <pathDir> <cwd> <command> <args...> — ORDER matters
		// ("" pathDir must be present so $1..$N line up with the script)
		expect(args.slice(4)).toEqual([
			"sh",
			"",
			"/mnt/c/vault",
			"/home/u/agent",
			"acp",
		]);
	});

	it("keeps a command path with spaces as a single, correctly-positioned argv element", () => {
		const { args } = wrapCommandForWsl(
			"/home/u/my agent",
			[],
			"C:\\vault",
			undefined,
			undefined,
			true,
		);
		expect(args.slice(4)).toEqual([
			"sh",
			"",
			"/mnt/c/vault",
			"/home/u/my agent",
		]);
	});

	it("forwards the additionalPath dir as the first positional (before cwd)", () => {
		const { args } = wrapCommandForWsl(
			"/home/u/agent",
			[],
			"C:\\vault",
			undefined,
			"C:\\node\\bin",
			true,
		);
		expect(args.slice(4)).toEqual([
			"sh",
			"/mnt/c/node/bin",
			"/mnt/c/vault",
			"/home/u/agent",
		]);
	});

	it("passes -d <distribution> before the launcher header", () => {
		const { args } = wrapCommandForWsl(
			"/home/u/agent",
			[],
			"C:\\vault",
			"Ubuntu",
			undefined,
			true,
		);
		expect(args.slice(0, 5)).toEqual([
			"-d",
			"Ubuntu",
			"--exec",
			"/bin/sh",
			"-c",
		]);
		// positionals (index 5 is the launcher script)
		expect(args.slice(6)).toEqual([
			"sh",
			"",
			"/mnt/c/vault",
			"/home/u/agent",
		]);
	});
});

describe("wrapCommandForWsl — terminal (shell string)", () => {
	it("uses sh -c wrapper and lets the shell parse the command (pipes)", () => {
		const { command, args } = wrapCommandForWsl(
			"ls -la | grep foo",
			[],
			"C:\\vault",
			undefined,
			undefined,
			false,
		);
		expect(command).toBe(WSL_EXE);
		expect(args).toContain("sh");
		expect(args).toContain("-c");
		const wrapper = args[args.indexOf("-c") + 1];
		// login shell + profile sourcing preserved
		expect(wrapper).toContain(". ~/.profile");
		expect(wrapper).toContain(" -l ");
		// command is left raw so the shell parses the pipe
		expect(wrapper).toContain("ls -la | grep foo");
	});
});

describe("wrapCommandForWsl — validation", () => {
	it("rejects UNC working directories", () => {
		expect(() =>
			wrapCommandForWsl("/x", [], "\\\\server\\share"),
		).toThrow(/UNC/);
	});
	it("rejects invalid distribution names", () => {
		expect(() =>
			wrapCommandForWsl("/x", [], "C:\\v", "bad;name"),
		).toThrow(/distribution/i);
	});
});

describe("prepareShellCommand", () => {
	it("WSL agent: wsl.exe via --exec, no shell", () => {
		Platform.isWin = true;
		const r = prepareShellCommand("/home/u/agent", ["acp"], "C:\\vault", {
			wslMode: true,
			alwaysEscape: true,
		});
		expect(r.command).toBe(WSL_EXE);
		expect(r.needsShell).toBe(false);
		expect(r.args).toContain("--exec");
	});

	it("WSL terminal: wsl.exe via sh -c wrapper", () => {
		Platform.isWin = true;
		const r = prepareShellCommand("ls | grep x", [], "C:\\vault", {
			wslMode: true,
			alwaysEscape: false,
		});
		expect(r.command).toBe(WSL_EXE);
		expect(r.args).toContain("sh");
		expect(r.args).not.toContain("--exec");
	});

	it("macOS: wraps in a login shell (-l -c)", () => {
		Platform.isMacOS = true;
		const r = prepareShellCommand("agent", [], "/home/u", {
			wslMode: false,
		});
		expect(r.args[0]).toBe("-l");
		expect(r.args[1]).toBe("-c");
		expect(r.needsShell).toBe(false);
	});

	it("Windows non-WSL: needs cmd.exe shell", () => {
		Platform.isWin = true;
		const r = prepareShellCommand("agent", ["x"], "C:\\vault", {
			wslMode: false,
		});
		expect(r.needsShell).toBe(true);
	});
});

describe("buildWslEnv", () => {
	it("adds a forwarded key with the /u flag", () => {
		const out = buildWslEnv({ FOO: "bar" }, ["FOO"]);
		expect(out.WSLENV).toBe("FOO/u");
	});

	it("skips empty values (never clobbers a profile-set var)", () => {
		const base = { FOO: "" };
		const out = buildWslEnv(base, ["FOO"]);
		expect(out.WSLENV).toBeUndefined();
		expect(out).toBe(base); // unchanged reference when nothing to add
	});

	it("skips undefined values", () => {
		const out = buildWslEnv({}, ["MISSING"]);
		expect(out.WSLENV).toBeUndefined();
	});

	it("skips invalid key names", () => {
		const out = buildWslEnv({ "A:B": "x" }, ["A:B"]);
		expect(out.WSLENV).toBeUndefined();
	});

	it("merges with an existing WSLENV without clobbering", () => {
		const out = buildWslEnv({ FOO: "bar", WSLENV: "EXISTING/p" }, ["FOO"]);
		expect(out.WSLENV).toBe("EXISTING/p:FOO/u");
	});

	it("does not duplicate an already-listed key", () => {
		const out = buildWslEnv({ FOO: "bar", WSLENV: "FOO/p" }, ["FOO"]);
		expect(out.WSLENV).toBe("FOO/p");
	});

	it("does not mutate the input env", () => {
		const base: NodeJS.ProcessEnv = { FOO: "bar" };
		buildWslEnv(base, ["FOO"]);
		expect(base.WSLENV).toBeUndefined();
	});
});

describe("isSameDirectory", () => {
	it("treats equivalent WSL and Windows paths as the same", () => {
		expect(isSameDirectory("/mnt/c/x", "C:\\x")).toBe(true);
	});
	it("ignores trailing slashes", () => {
		expect(isSameDirectory("/mnt/c/x/", "/mnt/c/x")).toBe(true);
	});
	it("is case-insensitive on Windows", () => {
		Platform.isWin = true;
		expect(isSameDirectory("C:\\Foo", "C:\\foo")).toBe(true);
	});
	it("is case-sensitive off Windows", () => {
		Platform.isWin = false;
		expect(isSameDirectory("/mnt/c/Foo", "/mnt/c/foo")).toBe(false);
	});
});
