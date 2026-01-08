import { Modal, App, setIcon } from "obsidian";
import type { SessionInfo } from "../../domain/models/session-info";

/**
 * Props for SessionHistoryModal.
 */
export interface SessionHistoryModalProps {
	/** List of sessions to display */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;
	/** Current working directory for filtering */
	currentCwd: string;

	// Capability flags (from useSessionHistory)
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether session/load is supported (stable) */
	canLoad: boolean;
	/** Whether session/resume is supported (unstable) */
	canResume: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;

	/** Whether using locally saved sessions (instead of agent session/list) */
	isUsingLocalSessions: boolean;

	/** Whether the agent is ready (initialized) */
	isAgentReady: boolean;

	/** Whether debug mode is enabled (shows manual input form) */
	debugMode: boolean;

	/** Callback when a session is selected for loading (with history replay) */
	onLoadSession: (sessionId: string, cwd: string) => void;
	/** Callback when a session is resumed (without history replay) */
	onResumeSession: (sessionId: string, cwd: string) => void;
	/** Callback when a session is forked (create new branch) */
	onForkSession: (sessionId: string, cwd: string) => void;
	/** Callback to load more sessions (pagination) */
	onLoadMore: () => void;
	/** Callback to fetch sessions with filter */
	onFetchSessions: (cwd?: string) => void;
}

/**
 * Modal for displaying and selecting from session history.
 *
 * Renders a list of previous chat sessions, allows filtering by working
 * directory, and supports pagination for large session lists.
 *
 * Buttons are conditionally displayed based on agent capabilities:
 * - Load button: canLoad (stable, shows history)
 * - Resume button: canResume (unstable, no history replay)
 * - Fork button: canFork (unstable, create branch)
 *
 * In debug mode, shows a manual input form for testing session operations.
 */
export class SessionHistoryModal extends Modal {
	private props: SessionHistoryModalProps;
	private filterByCurrentVault = true;

	// Debug mode input values
	private debugSessionId = "";
	private debugCwd = "";

	constructor(app: App, props: SessionHistoryModalProps) {
		super(app);
		this.props = props;
		// Initialize debug cwd with current vault path
		this.debugCwd = props.currentCwd;
	}

	/**
	 * Update modal props and re-render.
	 * Call this when session data changes.
	 */
	updateProps(props: SessionHistoryModalProps) {
		this.props = props;
		this.render();
	}

	/**
	 * Called when modal is opened.
	 * Sets up the modal UI.
	 */
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal title
		contentEl.createEl("h2", { text: "Session History" });

		// Render the content
		this.render();
	}

	/**
	 * Render the modal content.
	 * Called initially and when props update.
	 */
	private render() {
		const { contentEl } = this;
		const {
			sessions,
			loading,
			error,
			hasMore,
			canList,
			isUsingLocalSessions,
			isAgentReady,
			debugMode,
		} = this.props;

		// Clear previous content (except title)
		const title = contentEl.querySelector("h2");
		contentEl.empty();
		if (title) {
			contentEl.appendChild(title);
		}

		// Show preparing message if agent is not ready
		if (!isAgentReady) {
			const preparingContainer = contentEl.createDiv({
				cls: "agent-client-session-history-loading",
			});
			preparingContainer.createEl("p", {
				text: "Preparing agent...",
			});
			return;
		}

		// Debug mode: Manual input form
		if (debugMode) {
			this.renderDebugForm(contentEl);
		}

		// Show local sessions banner if using locally saved sessions
		if (isUsingLocalSessions) {
			const banner = contentEl.createDiv({
				cls: "agent-client-session-history-local-banner",
			});
			banner.createSpan({
				text: "Locally saved sessions (agent doesn't support session/list)",
			});
		}

		// Show list UI if canList is true OR using local sessions
		const canShowList = canList || isUsingLocalSessions;
		if (!canShowList) {
			if (!debugMode) {
				// Show message that list is not available
				const messageContainer = contentEl.createDiv({
					cls: "agent-client-session-history-empty",
				});
				messageContainer.createEl("p", {
					text: "Session list is not available for this agent.",
					cls: "agent-client-session-history-empty-text",
				});
				messageContainer.createEl("p", {
					text: "Enable Debug Mode in settings to manually enter session IDs.",
					cls: "agent-client-session-history-empty-text",
				});
			}
			return;
		}

		// Filter toggle container - only show when using agent's session/list
		// (local sessions are already filtered by agentId and cwd)
		if (canList && !isUsingLocalSessions) {
			const filterContainer = contentEl.createDiv({
				cls: "agent-client-session-history-filter",
			});

			// Filter toggle checkbox
			const filterLabel = filterContainer.createEl("label", {
				cls: "agent-client-session-history-filter-label",
			});

			const filterCheckbox = filterLabel.createEl("input", {
				type: "checkbox",
			});
			filterCheckbox.checked = this.filterByCurrentVault;
			filterCheckbox.addEventListener("change", () => {
				this.filterByCurrentVault = filterCheckbox.checked;
				// Fetch sessions with or without cwd filter
				const cwd = this.filterByCurrentVault
					? this.props.currentCwd
					: undefined;
				this.props.onFetchSessions(cwd);
			});

			filterLabel.createSpan({
				text: "Show current vault only",
			});
		}

		// Display error if present
		if (error) {
			const errorContainer = contentEl.createDiv({
				cls: "agent-client-session-history-error",
			});

			errorContainer.createEl("p", {
				text: error,
				cls: "agent-client-session-history-error-text",
			});

			const retryButton = errorContainer.createEl("button", {
				text: "Retry",
				cls: "agent-client-session-history-retry-button",
			});
			retryButton.addEventListener("click", () => {
				const cwd = this.filterByCurrentVault
					? this.props.currentCwd
					: undefined;
				this.props.onFetchSessions(cwd);
			});

			return;
		}

		// Display loading indicator if loading and no sessions yet
		if (loading && sessions.length === 0) {
			const loadingContainer = contentEl.createDiv({
				cls: "agent-client-session-history-loading",
			});
			loadingContainer.createEl("p", {
				text: "Loading sessions...",
			});
			return;
		}

		// Display empty state if no sessions
		if (sessions.length === 0) {
			const emptyContainer = contentEl.createDiv({
				cls: "agent-client-session-history-empty",
			});
			emptyContainer.createEl("p", {
				text: "No previous sessions",
				cls: "agent-client-session-history-empty-text",
			});
			return;
		}

		// Render session list
		const listContainer = contentEl.createDiv({
			cls: "agent-client-session-history-list",
		});

		sessions.forEach((session) => {
			const sessionItem = listContainer.createDiv({
				cls: "agent-client-session-history-item",
			});

			// Session content container (for title and metadata)
			const contentContainer = sessionItem.createDiv({
				cls: "agent-client-session-history-item-content",
			});

			// Session title
			const titleEl = contentContainer.createDiv({
				cls: "agent-client-session-history-item-title",
			});
			titleEl.createSpan({
				text: this.truncateTitle(session.title ?? "Untitled Session"),
			});

			// Session metadata container
			const metadataEl = contentContainer.createDiv({
				cls: "agent-client-session-history-item-metadata",
			});

			// Relative timestamp (only if updatedAt is available)
			if (session.updatedAt) {
				const timestampEl = metadataEl.createSpan({
					cls: "agent-client-session-history-item-timestamp",
				});
				timestampEl.setText(
					this.formatRelativeTime(new Date(session.updatedAt)),
				);
			}

			// Actions container
			const actionsContainer = sessionItem.createDiv({
				cls: "agent-client-session-history-item-actions",
			});

			// Load button (stable - with history replay)
			if (this.props.canLoad) {
				const loadButton = actionsContainer.createDiv({
					cls: "agent-client-session-history-action-icon agent-client-session-history-load-icon",
				});
				setIcon(loadButton, "file-text");
				loadButton.setAttribute(
					"aria-label",
					"Load session (with history)",
				);
				loadButton.addEventListener("click", (e) => {
					e.stopPropagation();
					this.close();
					this.props.onLoadSession(session.sessionId, session.cwd);
				});
			}

			// Resume button (unstable - without history replay)
			if (this.props.canResume) {
				const resumeButton = actionsContainer.createDiv({
					cls: "agent-client-session-history-action-icon agent-client-session-history-resume-icon",
				});
				setIcon(resumeButton, "play");
				resumeButton.setAttribute(
					"aria-label",
					"Resume session (without history)",
				);
				resumeButton.addEventListener("click", (e) => {
					e.stopPropagation();
					this.close();
					this.props.onResumeSession(session.sessionId, session.cwd);
				});
			}

			// Fork button (unstable - create new branch)
			if (this.props.canFork) {
				const forkButton = actionsContainer.createDiv({
					cls: "agent-client-session-history-action-icon agent-client-session-history-fork-icon",
				});
				setIcon(forkButton, "git-branch");
				forkButton.setAttribute(
					"aria-label",
					"Fork session (create new branch)",
				);
				forkButton.addEventListener("click", (e) => {
					e.stopPropagation();
					this.close();
					this.props.onForkSession(session.sessionId, session.cwd);
				});
			}
		});

		// Pagination: Load more button
		if (hasMore) {
			const loadMoreContainer = contentEl.createDiv({
				cls: "agent-client-session-history-load-more",
			});

			const loadMoreButton = loadMoreContainer.createEl("button", {
				text: loading ? "Loading..." : "Load more",
				cls: "agent-client-session-history-load-more-button",
			});

			if (loading) {
				loadMoreButton.disabled = true;
			}

			loadMoreButton.addEventListener("click", () => {
				this.props.onLoadMore();
			});
		}
	}

	/**
	 * Render debug mode manual input form.
	 * In debug mode, all buttons are shown regardless of capabilities.
	 */
	private renderDebugForm(container: HTMLElement) {
		const debugContainer = container.createDiv({
			cls: "agent-client-session-history-debug",
		});

		debugContainer.createEl("h3", { text: "Debug: Manual Session Input" });

		// Session ID input
		const sessionIdGroup = debugContainer.createDiv({
			cls: "agent-client-session-history-debug-group",
		});
		sessionIdGroup.createEl("label", {
			text: "Session ID:",
			attr: { for: "debug-session-id" },
		});
		const sessionIdInput = sessionIdGroup.createEl("input", {
			type: "text",
			placeholder: "Enter session ID...",
			cls: "agent-client-session-history-debug-input",
			attr: { id: "debug-session-id" },
		});
		sessionIdInput.value = this.debugSessionId;
		sessionIdInput.addEventListener("input", () => {
			this.debugSessionId = sessionIdInput.value;
		});

		// CWD input
		const cwdGroup = debugContainer.createDiv({
			cls: "agent-client-session-history-debug-group",
		});
		cwdGroup.createEl("label", {
			text: "Working Directory (cwd):",
			attr: { for: "debug-cwd" },
		});
		const cwdInput = cwdGroup.createEl("input", {
			type: "text",
			placeholder: "Enter working directory...",
			cls: "agent-client-session-history-debug-input",
			attr: { id: "debug-cwd" },
		});
		cwdInput.value = this.debugCwd;
		cwdInput.addEventListener("input", () => {
			this.debugCwd = cwdInput.value;
		});

		// Action buttons - in debug mode, show all buttons regardless of capabilities
		const actionsContainer = debugContainer.createDiv({
			cls: "agent-client-session-history-debug-actions",
		});

		// Load button
		const loadButton = actionsContainer.createEl("button", {
			text: "Load",
			cls: "agent-client-session-history-debug-button",
		});
		loadButton.addEventListener("click", () => {
			if (this.debugSessionId.trim()) {
				this.close();
				this.props.onLoadSession(
					this.debugSessionId.trim(),
					this.debugCwd.trim() || this.props.currentCwd,
				);
			}
		});

		// Resume button
		const resumeButton = actionsContainer.createEl("button", {
			text: "Resume",
			cls: "agent-client-session-history-debug-button",
		});
		resumeButton.addEventListener("click", () => {
			if (this.debugSessionId.trim()) {
				this.close();
				this.props.onResumeSession(
					this.debugSessionId.trim(),
					this.debugCwd.trim() || this.props.currentCwd,
				);
			}
		});

		// Fork button
		const forkButton = actionsContainer.createEl("button", {
			text: "Fork",
			cls: "agent-client-session-history-debug-button",
		});
		forkButton.addEventListener("click", () => {
			if (this.debugSessionId.trim()) {
				this.close();
				this.props.onForkSession(
					this.debugSessionId.trim(),
					this.debugCwd.trim() || this.props.currentCwd,
				);
			}
		});

		// Separator
		debugContainer.createEl("hr", {
			cls: "agent-client-session-history-debug-separator",
		});
	}

	/**
	 * Truncate session title to 50 characters with ellipsis.
	 */
	private truncateTitle(title: string): string {
		if (title.length <= 50) {
			return title;
		}
		return title.slice(0, 50) + "...";
	}

	/**
	 * Format timestamp as relative time.
	 * Examples: "2 hours ago", "yesterday", "3 days ago"
	 */
	private formatRelativeTime(date: Date): string {
		const now = Date.now();
		const timestamp = date.getTime();
		const diffMs = now - timestamp;
		const diffSeconds = Math.floor(diffMs / 1000);
		const diffMinutes = Math.floor(diffSeconds / 60);
		const diffHours = Math.floor(diffMinutes / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMinutes < 1) {
			return "just now";
		} else if (diffMinutes < 60) {
			return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
		} else if (diffDays === 1) {
			return "yesterday";
		} else if (diffDays < 7) {
			return `${diffDays} days ago`;
		} else {
			// Fall back to absolute date for > 7 days
			const month = date.toLocaleString("default", { month: "short" });
			const day = date.getDate();
			const year = date.getFullYear();
			return `${month} ${day}, ${year}`;
		}
	}

	/**
	 * Format working directory to show last 2 path segments.
	 * Example: "/Users/name/projects/my-vault" → "projects/my-vault"
	 */
	private formatWorkingDirectory(cwd: string): string {
		const segments = cwd.split(/[/\\]/); // Handle both Unix and Windows paths
		const lastTwo = segments.slice(-2);
		return lastTwo.join("/");
	}

	/**
	 * Called when modal is closed.
	 * Cleanup.
	 */
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
