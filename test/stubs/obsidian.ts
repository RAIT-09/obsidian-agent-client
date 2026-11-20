/**
 * Lightweight `obsidian` stub for unit tests.
 *
 * The real `obsidian` module only exists inside the Obsidian runtime, so
 * `vitest.config.mts` aliases the bare `obsidian` import to this file.
 *
 * Exports provided:
 * - `Platform`: flags read at call time by `src/utils/platform.ts` /
 *   `src/utils/paths.ts`. Tests mutate these to exercise platform branches.
 * - `parseYaml`: YAML parser used by `src/utils/agent-block-parser.ts`,
 *   delegated to the `yaml` package.
 * - `requestUrl`: network stand-in that always rejects (see below).
 */

import { parse as parseYamlImpl } from "yaml";

export const Platform = {
	isWin: false,
	isMacOS: false,
	isLinux: false,
	isDesktopApp: true,
};

/**
 * Minimal `TFile` stand-in for tests that resolve wikilinks or classify
 * dragged files. Only the fields those read (`path`, `basename`, `extension`)
 * plus real-class identity so that `resolved instanceof TFile` works with
 * fixtures. `extension` is derived from `path` like Obsidian does.
 */
export class TFile {
	path: string;
	basename: string;
	extension: string;
	constructor(path: string, basename: string) {
		this.path = path;
		this.basename = basename;
		const name = path.split("/").pop() ?? path;
		const dot = name.lastIndexOf(".");
		this.extension = dot === -1 ? "" : name.slice(dot + 1);
	}
}

/**
 * Parse a YAML document. Mirrors Obsidian's `parseYaml`, which is a thin
 * wrapper over the `yaml` package.
 */
export function parseYaml(content: string): unknown {
	return parseYamlImpl(content);
}

/**
 * Split a linktext into path + subpath. Mirrors Obsidian's `parseLinktext`:
 * the subpath keeps its leading '#' and is '' when absent.
 */
export function parseLinktext(linktext: string): {
	path: string;
	subpath: string;
} {
	const hash = linktext.indexOf("#");
	if (hash === -1) return { path: linktext, subpath: "" };
	return { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

/**
 * Network stand-in. Always rejects: unit tests must not reach the npm
 * registry, and update-checker treats a network failure as "no result",
 * which keeps version-check paths deterministic in tests.
 */
export function requestUrl(): Promise<never> {
	return Promise.reject(new Error("requestUrl is not available in tests"));
}
