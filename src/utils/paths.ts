import { execFile } from "child_process";
import { Platform } from "obsidian";
import { access, stat } from "fs/promises";
import { constants } from "fs";
import { join, posix } from "path";
import {
	buildWslShellWrapper,
	convertWindowsPathToWsl,
	convertWslPathToWindows,
	getLoginShell,
} from "./platform";

/**
 * Check whether a path string is an absolute path (Unix or Windows).
 */
export function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Turn the `data-href` of an `a.internal-link` rendered from agent output into
 * a linktext Obsidian can resolve (for `openLinkText` / `hover-link`).
 *
 * Agents often link notes by absolute filesystem path, so an absolute path
 * inside the vault is converted to a vault-relative one. Relative paths and
 * wikilink-style targets pass through unchanged.
 *
 * @param rawHref - The link's `data-href` attribute (may be URI-encoded)
 * @param vaultBasePath - Absolute vault root, or null when not on a filesystem adapter
 * @param wslMode - Whether `/mnt/<drive>/...` paths should be read as Windows paths
 * @returns Linktext to resolve, or null for absolute paths outside the vault
 */
export function resolveInternalLinkHref(
	rawHref: string,
	vaultBasePath: string | null,
	wslMode: boolean,
): string | null {
	let href: string;
	try {
		href = decodeURIComponent(rawHref);
	} catch {
		// Malformed escape sequence (e.g. a literal "%") — use it verbatim
		href = rawHref;
	}

	if (vaultBasePath) {
		const normalizedVaultBase = normalizePathForComparison(
			vaultBasePath,
		).replace(/\/+$/, "");
		// WSL `/mnt/<drive>/...` paths are converted only for comparison, so
		// the conversion never touches the heading text we return
		const toComparable = (path: string) =>
			normalizePathForComparison(
				wslMode && path.startsWith("/mnt/")
					? convertWslPathToWindows(path)
					: path,
			);

		// The `#subpath` starts at the first `#` that isn't one of the vault
		// root's own (e.g. in `/Users/me/#work/vault`). Only the path before
		// it is normalized and checked, so heading text like `#A/../B` can
		// never change which file the link points to.
		let hashIndex = href.indexOf("#");
		while (hashIndex !== -1) {
			const before = toComparable(href.slice(0, hashIndex));
			const isVaultRootHash =
				normalizedVaultBase.startsWith(before) &&
				normalizedVaultBase[before.length] === "#";
			if (!isVaultRootHash) break;
			hashIndex = href.indexOf("#", hashIndex + 1);
		}
		const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
		const subpath = hashIndex === -1 ? "" : href.slice(hashIndex);

		const normalizedPath = toComparable(pathPart);
		if (normalizedPath.startsWith(normalizedVaultBase + "/")) {
			return (
				normalizedPath.slice(normalizedVaultBase.length + 1) + subpath
			);
		}
	}
	// Anything absolute is outside the vault by now. A leading backslash
	// (e.g. a UNC `\\server\share` path) counts too, though isAbsolutePath
	// doesn't treat it as absolute.
	if (!isAbsolutePath(href) && !href.startsWith("\\")) {
		return href;
	}
	return null;
}

/**
 * Normalize a path for a prefix comparison: forward slashes (so Windows paths
 * match too) and collapsed `.`/`..` segments (so `<vault>/../x` isn't mistaken
 * for an in-vault path).
 */
function normalizePathForComparison(path: string): string {
	const slashed = path.replace(/\\/g, "/");
	const normalized = posix.normalize(slashed);
	// posix.normalize collapses a UNC `//server` prefix to `/server`
	return slashed.startsWith("//") && !normalized.startsWith("//")
		? "/" + normalized
		: normalized;
}

/**
 * Best-effort fallback for when `which` returns nothing — e.g. macOS GUI-launched
 * apps (Finder/Dock) inherit a reduced PATH that excludes /opt/homebrew/bin, so
 * `which` can fail even when the command is installed. Probes common install
 * directories directly (PATH-independent), returning only an executable regular
 * file so the result matches what `which` would have returned.
 *
 * Best-effort and intentionally narrow: version-manager installs
 * (nvm/fnm/asdf/volta) and ~/.local/bin live in per-version directories a static
 * list cannot enumerate and are out of scope — those users get an honest
 * "Not found". (Windows solves the same reduced-PATH problem authoritatively via
 * the registry; see getFullWindowsPath in platform.ts. macOS has no such
 * side-channel, so this static last-resort list is a deliberate trade-off.)
 *
 * @param command - Bare command name (e.g. "node", "codex-acp")
 * @returns Absolute path to an executable file, or null if not found
 */
async function findInKnownPaths(command: string): Promise<string | null> {
	// Only resolve bare names within the listed dirs; never let a separator
	// escape via join() (defensive — current callers pass hardcoded names).
	if (command.includes("/") || command.includes("\\")) return null;

	const dirs = Platform.isMacOS
		? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
		: ["/usr/local/bin", "/usr/bin", "/bin"];

	for (const dir of dirs) {
		const candidate = join(dir, command);
		try {
			const st = await stat(candidate); // follows symlinks
			if (!st.isFile()) continue; // reject directories/sockets
			await access(candidate, constants.X_OK); // must be executable
			return candidate;
		} catch {
			// missing / not a runnable file / dangling symlink → keep scanning
		}
	}

	return null;
}

/**
 * Resolve the absolute path of a command using `which` (macOS/Linux) or `where` (Windows).
 * If the command is already an absolute path, returns it as-is.
 * Runs asynchronously to avoid blocking the Electron main thread.
 *
 * @param command - Command name (e.g. "node", "claude") or absolute path
 * @returns Absolute path string, or null if not found
 */
export function resolveCommandPath(command: string): Promise<string | null> {
	if (!command || command.trim().length === 0) return Promise.resolve(null);

	const trimmed = command.trim();

	if (isAbsolutePath(trimmed)) {
		return Promise.resolve(trimmed);
	}

	return new Promise((resolve) => {
		if (Platform.isWin) {
			execFile(
				"where",
				[trimmed],
				{ timeout: 5000, windowsHide: true },
				(err, stdout) => {
					if (err) {
						resolve(null);
						return;
					}
					const resolved = stdout.split("\n")[0].trim();
					resolve(resolved.length > 0 ? resolved : null);
				},
			);
		} else {
			const shell = getLoginShell();
			const escaped = trimmed.replace(/'/g, "'\\''");
			execFile(
				shell,
				["-l", "-c", `which '${escaped}'`],
				{ timeout: 5000 },
				(err, stdout) => {
					const fallback = () => {
						findInKnownPaths(trimmed).then(resolve, () =>
							resolve(null),
						);
					};
					if (err) {
						fallback();
						return;
					}
					const resolved = stdout.split("\n")[0].trim();
					if (resolved.length > 0) {
						resolve(resolved);
					} else {
						fallback();
					}
				},
			);
		}
	});
}

/**
 * Resolve the absolute path of a command inside WSL.
 * Uses the WSL shell wrapper (buildWslShellWrapper) to resolve within the Linux environment.
 *
 * @param command - Command name (e.g. "node", "claude")
 * @param distribution - Optional WSL distribution name
 * @returns Linux absolute path string, or null if not found
 */
export function resolveCommandPathInWsl(
	command: string,
	distribution?: string,
): Promise<string | null> {
	if (!command || command.trim().length === 0) return Promise.resolve(null);

	const trimmed = command.trim();

	if (isAbsolutePath(trimmed)) {
		return Promise.resolve(trimmed);
	}

	return new Promise((resolve) => {
		const escaped = trimmed.replace(/'/g, "'\\''");
		const args: string[] = [];
		if (distribution) {
			args.push("-d", distribution);
		}
		const innerCommand = `which '${escaped}'`;
		args.push("sh", "-c", buildWslShellWrapper(innerCommand));
		execFile(
			"C:\\Windows\\System32\\wsl.exe",
			args,
			{ timeout: 5000 },
			(err, stdout) => {
				if (err) {
					// No known-paths fallback here on purpose: a host-side
					// existsSync would check the Windows filesystem, not the
					// Linux FS inside WSL. The wrapper already runs a login
					// shell (-l, sources ~/.profile), so the reduced-PATH
					// problem is milder here than on a GUI-launched macOS app.
					resolve(null);
					return;
				}
				const resolved = stdout.split("\n")[0].trim();
				resolve(resolved.length > 0 ? resolved : null);
			},
		);
	});
}

/**
 * Extract the directory containing a command (for PATH adjustments).
 * Example: /usr/local/bin/node → /usr/local/bin
 *
 * @param command - Full path to a command
 * @returns Directory path, or null if cannot be determined
 */
export function resolveCommandDirectory(command: string): string | null {
	if (!command) {
		return null;
	}
	const lastSlash = Math.max(
		command.lastIndexOf("/"),
		command.lastIndexOf("\\"),
	);
	if (lastSlash <= 0) {
		return null;
	}
	return command.slice(0, lastSlash);
}

/**
 * Resolve the Node.js directory from the plugin's nodePath setting.
 * Returns the directory only when nodePath is an absolute path.
 * When nodePath is empty or a bare command name, returns undefined
 * (the login shell handles PATH resolution).
 *
 * @param nodePathSetting - The raw nodePath setting value
 * @returns Directory path, or undefined
 */
export function resolveNodeDirectory(
	nodePathSetting: string | undefined,
): string | undefined {
	if (!nodePathSetting) return undefined;
	const trimmed = nodePathSetting.trim();
	if (!isAbsolutePath(trimmed)) return undefined;
	return resolveCommandDirectory(trimmed) || undefined;
}

/**
 * Convert absolute path to relative path if it's under basePath.
 * Otherwise return the absolute path as-is.
 *
 * @param absolutePath - The absolute path to convert
 * @param basePath - The base path (e.g., vault path)
 * @returns Relative path if under basePath, otherwise absolute path
 */
export function toRelativePath(absolutePath: string, basePath: string): string {
	// Normalize paths (remove trailing slashes)
	const normalizedBase = basePath.replace(/\/+$/, "");
	const normalizedPath = absolutePath.replace(/\/+$/, "");

	if (normalizedPath.startsWith(normalizedBase + "/")) {
		return normalizedPath.slice(normalizedBase.length + 1);
	}
	return absolutePath;
}

/**
 * Resolve a vault-relative path to an absolute path with optional WSL conversion.
 *
 * @param relativePath - Vault-relative file path (e.g., "folder/note.md")
 * @param vaultBasePath - Absolute path to the vault root
 * @param convertToWsl - Whether to convert the result to WSL path format
 * @returns Absolute file path
 */
export function resolveAbsolutePath(
	relativePath: string,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const absolutePath = vaultBasePath
		? `${vaultBasePath}/${relativePath}`
		: relativePath;
	return convertToWsl
		? convertWindowsPathToWsl(absolutePath)
		: absolutePath;
}

/**
 * Build a file URI from an absolute path.
 * Handles both Windows and Unix paths.
 *
 * @param absolutePath - Absolute file path
 * @returns file:// URI
 *
 * @example
 * buildFileUri("/Users/user/note.md") // "file:///Users/user/note.md"
 * buildFileUri("C:\\Users\\user\\note.md") // "file:///C:/Users/user/note.md"
 */
export function buildFileUri(absolutePath: string): string {
	// Normalize backslashes to forward slashes
	const normalizedPath = absolutePath.replace(/\\/g, "/");

	// Windows path (e.g., C:/Users/...)
	if (/^[A-Za-z]:/.test(normalizedPath)) {
		return `file:///${normalizedPath}`;
	}

	// Unix path (e.g., /Users/...)
	return `file://${normalizedPath}`;
}
