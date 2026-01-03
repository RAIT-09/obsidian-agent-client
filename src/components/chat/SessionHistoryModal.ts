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

	/** Callback when a session is selected for loading */
	onLoadSession: (sessionId: string, workingDirectory: string, fork: boolean) => void;
	/** Callback when a session is renamed */
	onRenameSession: (sessionId: string, newTitle: string) => void;
	/** Callback when a session is deleted */
	onDeleteSession: (sessionId: string, workingDirectory: string) => void;
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
 */
export class SessionHistoryModal extends Modal {
	private props: SessionHistoryModalProps;
	private filterByCurrentVault = true;

	constructor(app: App, props: SessionHistoryModalProps) {
		super(app);
		this.props = props;
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
		const { sessions, loading, error, hasMore } = this.props;

		// Clear previous content (except title)
		const title = contentEl.querySelector("h2");
		contentEl.empty();
		if (title) {
			contentEl.appendChild(title);
		}

		// Filter toggle container
		const filterContainer = contentEl.createDiv({
			cls: "session-history-filter",
		});

		// Filter toggle checkbox
		const filterLabel = filterContainer.createEl("label", {
			cls: "session-history-filter-label",
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

		// Display error if present
		if (error) {
			const errorContainer = contentEl.createDiv({
				cls: "session-history-error",
			});

			const errorText = errorContainer.createEl("p", {
				text: error,
				cls: "session-history-error-text",
			});

			const retryButton = errorContainer.createEl("button", {
				text: "Retry",
				cls: "session-history-retry-button",
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
				cls: "session-history-loading",
			});
			loadingContainer.createEl("p", {
				text: "Loading sessions...",
			});
			return;
		}

		// Display empty state if no sessions
		if (sessions.length === 0) {
			const emptyContainer = contentEl.createDiv({
				cls: "session-history-empty",
			});
			emptyContainer.createEl("p", {
				text: "No previous sessions",
				cls: "session-history-empty-text",
			});
			return;
		}

		// Render session list
		const listContainer = contentEl.createDiv({
			cls: "session-history-list",
		});

		sessions.forEach((session) => {
			const sessionItem = listContainer.createDiv({
				cls: "session-history-item",
			});

			// Session content container (for title and metadata)
			const contentContainer = sessionItem.createDiv({
				cls: "session-history-item-content",
			});

			// Session title
			const titleEl = contentContainer.createDiv({
				cls: "session-history-item-title",
			});
			titleEl.createSpan({
				text: this.truncateTitle(session.title),
			});

			// Session metadata container
			const metadataEl = contentContainer.createDiv({
				cls: "session-history-item-metadata",
			});

			// Relative timestamp
			const timestampEl = metadataEl.createSpan({
				cls: "session-history-item-timestamp",
			});
			timestampEl.setText(this.formatRelativeTime(new Date(session.updatedAt)));

			// Actions container
			const actionsContainer = sessionItem.createDiv({
				cls: "session-history-item-actions",
			});

			// Resume button (icon)
			const resumeButton = actionsContainer.createDiv({
				cls: "session-history-action-icon session-history-resume-icon",
			});
			setIcon(resumeButton, "play");
			resumeButton.setAttribute("aria-label", "Resume session (continue original)");
			resumeButton.addEventListener("click", (e) => {
				e.stopPropagation();
				this.close();
				this.props.onLoadSession(
					session.sessionId,
					session.workingDirectory || session.cwd,
					false, // fork=false: resume original
				);
			});

			// Fork button (icon)
			const forkButton = actionsContainer.createDiv({
				cls: "session-history-action-icon session-history-fork-icon",
			});
			setIcon(forkButton, "git-branch");
			forkButton.setAttribute("aria-label", "Fork session (create new branch)");
			forkButton.addEventListener("click", (e) => {
				e.stopPropagation();
				this.close();
				this.props.onLoadSession(
					session.sessionId,
					session.workingDirectory || session.cwd,
					true, // fork=true: create new branch
				);
			});

			// Rename button (icon)
			const renameButton = actionsContainer.createDiv({
				cls: "session-history-action-icon session-history-rename-icon",
			});
			setIcon(renameButton, "pencil");
			renameButton.setAttribute("aria-label", "Rename session");
			renameButton.addEventListener("click", (e) => {
				e.stopPropagation();
				const newTitle = prompt(`Rename session:`, session.title);
				if (newTitle && newTitle.trim()) {
					this.props.onRenameSession(
						session.sessionId,
						newTitle.trim(),
					);
				}
			});

			// Delete button (icon)
			const deleteButton = actionsContainer.createDiv({
				cls: "session-history-action-icon session-history-delete-icon",
			});
			setIcon(deleteButton, "trash-2");
			deleteButton.setAttribute("aria-label", "Delete session");
			deleteButton.addEventListener("click", (e) => {
				e.stopPropagation();
				// Confirm deletion
				if (confirm(`Delete session "${session.title}"?`)) {
					this.props.onDeleteSession(
						session.sessionId,
						session.workingDirectory || session.cwd,
					);
				}
			});
		});

		// Pagination: Load more button
		if (hasMore) {
			const loadMoreContainer = contentEl.createDiv({
				cls: "session-history-load-more",
			});

			const loadMoreButton = loadMoreContainer.createEl("button", {
				text: loading ? "Loading..." : "Load more",
				cls: "session-history-load-more-button",
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
