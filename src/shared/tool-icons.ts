/**
 * Maps tool titles and kinds to Obsidian Lucide icon names.
 *
 * Lookup chain: exact title → normalized title → MCP prefix → pattern → kind → default.
 * Covers tools from Claude Code, Cursor, Codex, Gemini CLI, Cline, Windsurf, and others.
 */

import type { ToolKind } from "../domain/models/chat-message";

const TOOL_TITLE_ICONS: Record<string, string> = {
	// ── File read ──
	Read: "file-text",
	ReadFile: "file-text",
	ViewFile: "file-text",

	// ── File write / create ──
	Write: "file-plus",
	WriteFile: "file-plus",
	CreateFile: "file-plus",

	// ── File edit ──
	Edit: "file-pen",
	EditFile: "file-pen",
	MultiEdit: "file-pen",
	StrReplace: "file-pen",
	ApplyPatch: "file-pen",
	NotebookEdit: "file-pen",
	EditNotebook: "file-pen",

	// ── File delete ──
	Delete: "trash-2",
	DeleteFile: "trash-2",

	// ── File move / rename ──
	Move: "move",
	RenameFile: "move",

	// ── Shell / terminal ──
	Bash: "terminal",
	Shell: "terminal",
	BashOutput: "terminal",
	KillShell: "terminal",
	RunCommand: "terminal",

	// ── Search ──
	Grep: "search",
	SearchFiles: "search",

	// ── Directory / glob ──
	Glob: "folder-search",
	LS: "list",
	ListDirectory: "list",

	// ── Linting / diagnostics ──
	ReadLints: "alert-circle",

	// ── Todo / task ──
	TodoWrite: "list-checks",
	TodoRead: "list-checks",
	Task: "bot",
	TaskOutput: "bot",

	// ── MCP ──
	Mcp: "wrench",
	CallMcpTool: "wrench",
	ListMcpResources: "list",
	ReadMcpResource: "file-text",
	FetchMcpResource: "download",

	// ── Web ──
	WebSearch: "globe",
	WebFetch: "download",

	// ── User interaction ──
	AskUserQuestion: "help-circle",
	AskQuestion: "help-circle",
	AskFollowupQuestion: "help-circle",

	// ── Completion / mode ──
	AttemptCompletion: "check-circle",
	Skill: "zap",
	EnterPlanMode: "map",
	ExitPlanMode: "check-circle",
	SwitchMode: "arrow-right-left",

	// ── Code / definitions ──
	ListCodeDefinitionNames: "code",
	InsertCodeBlock: "code",

	// ── Browser ──
	BrowserAction: "globe",
};

/**
 * Pre-computed lowercase lookup for case-insensitive + underscore-insensitive matching.
 * Handles snake_case variants (read_file, write_to_file, etc.) from Codex/Cline/Copilot.
 */
const TOOL_TITLE_NORMALIZED: Record<string, string> = {};
for (const [key, value] of Object.entries(TOOL_TITLE_ICONS)) {
	TOOL_TITLE_NORMALIZED[key.toLowerCase()] = value;
}
Object.assign(TOOL_TITLE_NORMALIZED, {
	read_file: "file-text",
	readfile: "file-text",
	write_file: "file-plus",
	writefile: "file-plus",
	write_to_file: "file-plus",
	writetofile: "file-plus",
	create_file: "file-plus",
	createfile: "file-plus",
	edit_file: "file-pen",
	editfile: "file-pen",
	apply_diff: "file-pen",
	applydiff: "file-pen",
	apply_patch: "file-pen",
	applypatch: "file-pen",
	replace_in_file: "file-pen",
	replaceinfile: "file-pen",
	delete_file: "trash-2",
	deletefile: "trash-2",
	rename_file: "move",
	renamefile: "move",
	move_file: "move",
	movefile: "move",
	run_command: "terminal",
	runcommand: "terminal",
	execute_command: "terminal",
	executecommand: "terminal",
	search_files: "search",
	searchfiles: "search",
	list_files: "list",
	listfiles: "list",
	list_directory: "list",
	listdirectory: "list",
	read_lints: "alert-circle",
	readlints: "alert-circle",
	todo_write: "list-checks",
	todowrite: "list-checks",
	todo_read: "list-checks",
	todoread: "list-checks",
	ask_followup_question: "help-circle",
	askfollowupquestion: "help-circle",
	ask_user_question: "help-circle",
	askuserquestion: "help-circle",
	ask_question: "help-circle",
	askquestion: "help-circle",
	attempt_completion: "check-circle",
	attemptcompletion: "check-circle",
	browser_action: "globe",
	browseraction: "globe",
	use_mcp_tool: "wrench",
	usemcptool: "wrench",
	access_mcp_resource: "file-text",
	accessmcpresource: "file-text",
	list_code_definition_names: "code",
	listcodedefinitionnames: "code",
	insert_code_block: "code",
	insertcodeblock: "code",
	web_search: "globe",
	websearch: "globe",
	web_fetch: "download",
	webfetch: "download",
	fetch_mcp_resource: "download",
	fetchmcpresource: "download",
	call_mcp_tool: "wrench",
	callmcptool: "wrench",
	switch_mode: "arrow-right-left",
	switchmode: "arrow-right-left",
	enter_plan_mode: "map",
	enterplanmode: "map",
	exit_plan_mode: "check-circle",
	exitplanmode: "check-circle",
	str_replace: "file-pen",
	strreplace: "file-pen",
	multi_edit: "file-pen",
	multiedit: "file-pen",
	notebook_edit: "file-pen",
	notebookedit: "file-pen",
	edit_notebook: "file-pen",
	editnotebook: "file-pen",
	kill_shell: "terminal",
	killshell: "terminal",
	bash_output: "terminal",
	bashoutput: "terminal",
});

/**
 * Pattern-based fallback for titles that don't match any known name.
 * Ordered by specificity — more specific patterns first.
 */
const TITLE_PATTERNS: [RegExp, string][] = [
	[/\b(?:web[_-]?search|search[_-]?web)\b/i, "globe"],
	[/\b(?:web[_-]?fetch|fetch[_-]?url)\b/i, "download"],
	[/\b(?:browser|navigate|page)\b/i, "globe"],
	[/\b(?:lint|diagnostic)\b/i, "alert-circle"],
	[/\b(?:notebook)\b/i, "file-pen"],
	[/\b(?:todo|checklist)\b/i, "list-checks"],
	[/\b(?:task|subagent|spawn)\b/i, "bot"],
	[/\b(?:ask|question|prompt|confirm)\b/i, "help-circle"],
	[/\b(?:plan|think|reason|reflect)\b/i, "brain"],
	[/\b(?:skill|agent|plugin)\b/i, "zap"],
	[/\b(?:mode|switch)\b/i, "arrow-right-left"],
	[/\b(?:complete|finish|done)\b/i, "check-circle"],
	[/\b(?:bash|shell|terminal|exec|run|command)\b/i, "terminal"],
	[/\b(?:glob|find[_-]?file)\b/i, "folder-search"],
	[/\b(?:grep|search|find|rg)\b/i, "search"],
	[/\b(?:ls|list[_-]?dir|directory)\b/i, "list"],
	[/\b(?:delete|remove|trash|rm)\b/i, "trash-2"],
	[/\b(?:move|rename|mv)\b/i, "move"],
	[/\b(?:write|create|touch|new[_-]?file)\b/i, "file-plus"],
	[/\b(?:edit|replace|patch|diff|modify|update)\b/i, "file-pen"],
	[/\b(?:read|view|cat|open|get[_-]?file)\b/i, "file-text"],
	[/\b(?:fetch|download|pull)\b/i, "download"],
	[/\b(?:mcp|tool[_-]?call)\b/i, "wrench"],
	[/\b(?:code|definition|symbol)\b/i, "code"],
];

const KIND_ICONS: Record<ToolKind, string> = {
	read: "file-text",
	edit: "file-pen",
	delete: "trash-2",
	move: "move",
	search: "search",
	execute: "terminal",
	think: "brain",
	fetch: "download",
	switch_mode: "arrow-right-left",
	other: "wrench",
};

/**
 * Resolve the Lucide icon name for a tool call.
 * Lookup chain: exact title → normalized → MCP prefix → pattern → kind → default.
 */
export function getToolIconName(
	title: string | null | undefined,
	kind: ToolKind | undefined,
): string {
	if (title) {
		const cleanTitle = title.replace(/\s+/g, "");
		if (TOOL_TITLE_ICONS[cleanTitle]) {
			return TOOL_TITLE_ICONS[cleanTitle];
		}

		const normalized = cleanTitle.replace(/[_-]/g, "").toLowerCase();
		if (TOOL_TITLE_NORMALIZED[normalized]) {
			return TOOL_TITLE_NORMALIZED[normalized];
		}

		if (title.startsWith("mcp__") || title.startsWith("CallMcpTool")) {
			return "wrench";
		}

		for (const [pattern, icon] of TITLE_PATTERNS) {
			if (pattern.test(title)) {
				return icon;
			}
		}
	}

	if (kind && KIND_ICONS[kind]) {
		return KIND_ICONS[kind];
	}

	return "wrench";
}

/**
 * Friendly labels for ToolKind values.
 * Used when no title is available.
 */
const KIND_DISPLAY_NAMES: Record<ToolKind, string> = {
	read: "Read",
	edit: "Edit",
	delete: "Delete",
	move: "Move",
	search: "Search",
	execute: "Execute",
	think: "Thinking",
	fetch: "Fetch",
	switch_mode: "Switch Mode",
	other: "Tool",
};

/**
 * Get the display name for a tool call.
 * Cleans up raw tool titles into user-friendly labels.
 */
export function getToolDisplayName(
	title: string | null | undefined,
	kind: ToolKind | undefined,
): string {
	if (title) {
		if (title.startsWith("mcp__")) {
			const parts = title.split("__");
			if (parts.length >= 3) {
				return formatSnakeCase(parts[parts.length - 1]);
			}
		}
		return title;
	}
	if (kind) return KIND_DISPLAY_NAMES[kind] ?? "Tool";
	return "Tool";
}

function formatSnakeCase(s: string): string {
	return s
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/**
 * Extract a human-readable summary from tool call data.
 * Shows the most relevant parameter for each tool type.
 */
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

		if (titleLower === "ls" || titleLower === "listdirectory" || titleLower === "listfiles") {
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

		if (titleLower === "switchmode" || titleLower === "enterplanmode" || titleLower === "exitplanmode") {
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
		const loc = locations[0];
		const rel = toRelativeFromVault(loc.path, vaultPath);
		return loc.line != null ? `${rel}:${loc.line}` : rel;
	}

	return "";
}

function extractCommandSummary(rawInput: Record<string, unknown>): string {
	let cmd = (rawInput.command as string) || "";
	if (Array.isArray(rawInput.args) && rawInput.args.length > 0) {
		cmd += ` ${(rawInput.args as string[]).join(" ")}`;
	}
	return truncate(cmd, 60);
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

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + "\u2026";
}

/**
 * Map domain status to CSS class suffix.
 * Bridges the gap between ACP status values and display states.
 */
export function getStatusDisplayClass(
	status: string | null | undefined,
): string {
	switch (status) {
		case "in_progress":
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
		case "error":
			return "error";
		default:
			return "";
	}
}

/**
 * Get the Lucide icon name for a status indicator.
 * Returns empty string for statuses that use animation instead of icon.
 */
export function getStatusIconName(status: string | null | undefined): string {
	switch (status) {
		case "completed":
			return "check";
		case "failed":
		case "error":
			return "x";
		default:
			return "";
	}
}
