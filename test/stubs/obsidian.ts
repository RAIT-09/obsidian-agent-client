/**
 * Lightweight `obsidian` stub for unit tests.
 *
 * The real `obsidian` module only exists inside the Obsidian runtime. The pure
 * utilities under test (`src/utils/platform.ts`, `src/utils/paths.ts`) only need
 * `Platform`, whose flags they read at call time. Tests mutate these flags to
 * exercise the platform-specific branches.
 */
export const Platform = {
	isWin: false,
	isMacOS: false,
	isLinux: false,
	isDesktopApp: true,
};
