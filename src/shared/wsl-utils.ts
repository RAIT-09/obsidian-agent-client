import { Platform } from "obsidian";

/**
 * Windowsパス → WSLパス変換
 * 例: C:\Users\name\vault → /mnt/c/Users/name/vault
 */
export function convertWindowsPathToWsl(windowsPath: string): string {
	if (!Platform.isWin) return windowsPath;

	// Normalize backslashes to forward slashes
	const normalized = windowsPath.replace(/\\/g, "/");

	// Match drive letter pattern: C:/... or C:\...
	const match = normalized.match(/^([A-Za-z]):(\/.*)/);

	if (match) {
		const driveLetter = match[1].toLowerCase();
		const pathPart = match[2];
		return `/mnt/${driveLetter}${pathPart}`;
	}

	return windowsPath;
}

/**
 * WSLパス → Windowsパス変換
 * 例: /mnt/c/Users/name/vault → C:\Users\name\vault
 */
export function convertWslPathToWindows(wslPath: string): string {
	if (!Platform.isWin) return wslPath;

	const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)/);

	if (match) {
		const driveLetter = match[1].toUpperCase();
		const pathPart = match[2].replace(/\//g, "\\");
		return `${driveLetter}:${pathPart}`;
	}

	return wslPath;
}

/**
 * WSLコマンドラッパー生成
 * wsl.exe を使用してWSL内でコマンドを実行
 */
export function wrapCommandForWsl(
	command: string,
	args: string[],
	cwd: string,
	distribution?: string,
): { command: string; args: string[] } {
	const wslCwd = convertWindowsPathToWsl(cwd);

	// wsl.exe を使用してWSL内でコマンドを実行
	const wslArgs: string[] = [];

	// ディストリビューション指定
	if (distribution) {
		wslArgs.push("-d", distribution);
	}

	// WSL内で実行するコマンド
	// cd してからコマンド実行（シェルを経由）
	const escapedArgs = args.map(escapeShellArg).join(" ");
	const fullCommand = `cd ${escapeShellArg(wslCwd)} && ${command} ${escapedArgs}`;
	wslArgs.push("bash", "-c", fullCommand);

	return {
		command: "wsl.exe",
		args: wslArgs,
	};
}

/**
 * シェル引数のエスケープ（Bash用）
 * シングルクォートでエスケープし、内部のシングルクォートは '\'' でエスケープ
 */
function escapeShellArg(arg: string): string {
	return `'${arg.replace(/'/g, "'\\''")}'`;
}
