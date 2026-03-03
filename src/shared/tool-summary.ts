import type { ToolKind } from "../domain/models/chat-message";

export function getToolSummary(
	title: string | null | undefined,
	kind: ToolKind | undefined,
	rawInput: Record<string, unknown> | undefined,
	locations: { path: string; line?: number | null }[] | undefined,
	vaultPath: string,
): string {
	if (!rawInput && !locations) return "";

	if (rawInput) {
		const titleLower = (title ?? "").replace(/[\s_-]+/g, "").toLowerCase();

		if (
			titleLower === "bash" ||
			titleLower === "shell" ||
			titleLower === "runcommand" ||
			titleLower === "executecommand" ||
			kind === "execute"
		) {
			return extractCommandSummary(rawInput);
		}

		if (
			titleLower === "grep" ||
			titleLower === "glob" ||
			titleLower === "searchfiles"
		) {
			const pattern =
				(rawInput.pattern as string) || (rawInput.glob_pattern as string) || "";
			if (pattern) return truncate(pattern, 50);
		}

		if (titleLower === "websearch" || titleLower === "websearch") {
			return truncate(
				(rawInput.query as string) || (rawInput.search_term as string) || "",
				50,
			);
		}

		if (titleLower === "webfetch") {
			return truncate((rawInput.url as string) || "", 50);
		}

		if (
			titleLower === "ls" ||
			titleLower === "listdirectory" ||
			titleLower === "listfiles"
		) {
			return fileNameOnly((rawInput.path as string) || ".");
		}

		if (titleLower === "task" || titleLower === "taskoutput") {
			return truncate((rawInput.description as string) || "", 50);
		}

		if (titleLower === "todowrite" || titleLower === "todoread") {
			const todos = rawInput.todos;
			if (Array.isArray(todos)) return `${todos.length} items`;
		}

		if (
			titleLower === "askquestion" ||
			titleLower === "askuserquestion" ||
			titleLower === "askfollowupquestion"
		) {
			return truncate(
				(rawInput.question as string) || (rawInput.prompt as string) || "",
				50,
			);
		}

		if (
			titleLower === "switchmode" ||
			titleLower === "enterplanmode" ||
			titleLower === "exitplanmode"
		) {
			return (rawInput.target_mode_id as string) || (rawInput.mode as string) || "";
		}

		if (titleLower === "readlints") {
			const paths = rawInput.paths;
			if (Array.isArray(paths) && paths.length > 0) {
				return fileNameOnly(paths[0] as string);
			}
		}

		if (titleLower === "browseraction") {
			return truncate((rawInput.action as string) || "", 50);
		}

		if (titleLower === "attemptcompletion") {
			return truncate((rawInput.result as string) || "", 50);
		}

		const filePath = extractFilePath(rawInput);
		if (filePath) {
			return fileNameOnly(filePath);
		}
	}

	if (locations && locations.length > 0) {
		const location = locations[0];
		const relativePath = toRelativeFromVault(location.path, vaultPath);
		return location.line != null
			? `${relativePath}:${location.line}`
			: relativePath;
	}

	return "";
}

function extractCommandSummary(rawInput: Record<string, unknown>): string {
	let command = (rawInput.command as string) || "";
	if (Array.isArray(rawInput.args) && rawInput.args.length > 0) {
		command += ` ${(rawInput.args as string[]).join(" ")}`;
	}
	return truncate(command, 60);
}

function extractFilePath(rawInput: Record<string, unknown>): string {
	return (
		(rawInput.file_path as string) ||
		(rawInput.path as string) ||
		(rawInput.filePath as string) ||
		""
	);
}

function fileNameOnly(filePath: string): string {
	if (!filePath) return "";
	const normalized = filePath.replace(/\\/g, "/");
	return normalized.split("/").pop() ?? normalized;
}

function toRelativeFromVault(absolutePath: string, vaultPath: string): string {
	const normalizedBase = vaultPath.replace(/\/+$/, "");
	const normalizedPath = absolutePath.replace(/\/+$/, "");
	if (normalizedPath.startsWith(normalizedBase + "/")) {
		return normalizedPath.slice(normalizedBase.length + 1);
	}
	return absolutePath;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + "\u2026";
}
