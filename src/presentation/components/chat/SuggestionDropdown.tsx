import * as React from "react";
const { useRef, useEffect, useMemo, useCallback, useState } = React;
import { Logger } from "../../../shared/logger";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { ChatView } from "../../views/chat/ChatView";
import type { NoteMetadata } from "../../../core/domain/ports/vault-access.port";
import type {
	SlashCommand,
	SlashCommandCategory,
} from "../../../core/domain/models/chat-session";

/**
 * Dropdown type for suggestion display.
 */
type DropdownType = "mention" | "slash-command";

/**
 * Props for the SuggestionDropdown component.
 *
 * This component can display either note mentions or slash commands
 * based on the `type` prop.
 */
interface SuggestionDropdownProps {
	/** Type of dropdown to display */
	type: DropdownType;

	/** Items to display (NoteMetadata for mentions, SlashCommand for commands) */
	items: NoteMetadata[] | SlashCommand[];

	/** Currently selected item index */
	selectedIndex: number;

	/** Callback when an item is selected */
	onSelect: (item: NoteMetadata | SlashCommand) => void;

	/** Callback to close the dropdown */
	onClose: () => void;

	/** Plugin instance for logging */
	plugin: AgentClientPlugin;

	/** View instance for event registration */
	view: ChatView;

	/** Optional search query for fuzzy match highlighting */
	searchQuery?: string;
}

/**
 * Category metadata for display.
 */
interface CategoryMeta {
	label: string;
	icon: string;
}

/**
 * Map of category to display metadata.
 */
const CATEGORY_META: Record<SlashCommandCategory, CategoryMeta> = {
	search: { label: "Search", icon: "search" },
	action: { label: "Actions", icon: "play" },
	navigation: { label: "Navigation", icon: "compass" },
	utility: { label: "Utility", icon: "settings" },
	custom: { label: "Other", icon: "terminal" },
};

/**
 * Category display order.
 */
const CATEGORY_ORDER: SlashCommandCategory[] = [
	"search",
	"action",
	"navigation",
	"utility",
	"custom",
];

/**
 * SVG icon components for each category.
 */
const CategoryIcon: React.FC<{ category: SlashCommandCategory }> = ({
	category,
}) => {
	const iconProps = {
		width: 14,
		height: 14,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};

	switch (category) {
		case "search":
			return (
				<svg {...iconProps} className="slash-command-icon">
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.35-4.35" />
				</svg>
			);
		case "action":
			return (
				<svg {...iconProps} className="slash-command-icon">
					<polygon points="5 3 19 12 5 21 5 3" />
				</svg>
			);
		case "navigation":
			return (
				<svg {...iconProps} className="slash-command-icon">
					<circle cx="12" cy="12" r="10" />
					<polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
				</svg>
			);
		case "utility":
			return (
				<svg {...iconProps} className="slash-command-icon">
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			);
		case "custom":
		default:
			return (
				<svg {...iconProps} className="slash-command-icon">
					<polyline points="4 17 10 11 4 5" />
					<line x1="12" y1="19" x2="20" y2="19" />
				</svg>
			);
	}
};

/**
 * Note icon for mention dropdown items.
 */
const NoteIcon: React.FC = () => (
	<svg
		width={14}
		height={14}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		className="mention-icon"
	>
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="16" y1="13" x2="8" y2="13" />
		<line x1="16" y1="17" x2="8" y2="17" />
		<polyline points="10 9 9 9 8 9" />
	</svg>
);

/**
 * Highlight matched characters in text using fuzzy matching.
 *
 * Returns an array of React elements with matched characters wrapped in <mark>.
 */
function highlightFuzzyMatch(text: string, query: string): React.ReactNode[] {
	if (!query || query.length === 0) {
		return [text];
	}

	const result: React.ReactNode[] = [];
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let queryIndex = 0;
	let lastMatchEnd = 0;

	for (let i = 0; i < text.length && queryIndex < lowerQuery.length; i++) {
		if (lowerText[i] === lowerQuery[queryIndex]) {
			// Add non-matched text before this match
			if (i > lastMatchEnd) {
				result.push(
					<span key={`text-${lastMatchEnd}`}>
						{text.slice(lastMatchEnd, i)}
					</span>,
				);
			}
			// Add the matched character
			result.push(
				<mark key={`match-${i}`} className="fuzzy-match">
					{text[i]}
				</mark>,
			);
			lastMatchEnd = i + 1;
			queryIndex++;
		}
	}

	// Add remaining text after last match
	if (lastMatchEnd < text.length) {
		result.push(
			<span key={`text-${lastMatchEnd}`}>
				{text.slice(lastMatchEnd)}
			</span>,
		);
	}

	return result;
}

/**
 * Group slash commands by category.
 */
function groupCommandsByCategory(
	commands: SlashCommand[],
): Map<SlashCommandCategory, SlashCommand[]> {
	const groups = new Map<SlashCommandCategory, SlashCommand[]>();

	for (const cmd of commands) {
		const category = cmd.category || "custom";
		if (!groups.has(category)) {
			groups.set(category, []);
		}
		groups.get(category)!.push(cmd);
	}

	return groups;
}

/**
 * Generic suggestion dropdown component.
 *
 * Displays either:
 * - Note mentions (@[[note]])
 * - Slash commands (/command)
 *
 * Features:
 * - Keyboard navigation hints in footer
 * - Category grouping for slash commands
 * - Fuzzy match highlighting
 * - Command icons based on category
 * - Hint preview on hover
 *
 * Implements WAI-ARIA Listbox pattern for accessibility.
 */
export const SuggestionDropdown = React.memo(function SuggestionDropdown({
	type,
	items,
	selectedIndex,
	onSelect,
	onClose,
	plugin,
	view,
	searchQuery,
}: SuggestionDropdownProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);
	const logger = useMemo(() => new Logger(plugin), [plugin]);
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

	// Generate unique IDs for ARIA
	const dropdownId = `suggestion-dropdown-${type}`;

	// Debug logging moved to useEffect to avoid running during render
	useEffect(() => {
		logger.log(`[DEBUG] SuggestionDropdown (${type}) rendered with:`, {
			itemsCount: items.length,
			selectedIndex,
		});
	}, [logger, type, items.length, selectedIndex]);

	// Handle mouse clicks outside dropdown to close
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		view.registerDomEvent(document, "mousedown", handleClickOutside);
	}, [onClose, view]);

	// Scroll selected item into view when selection changes
	useEffect(() => {
		if (dropdownRef.current && selectedIndex >= 0) {
			const selectedEl = dropdownRef.current.querySelector(
				`[data-index="${selectedIndex}"]`,
			);
			if (selectedEl) {
				selectedEl.scrollIntoView({ block: "nearest" });
			}
		}
	}, [selectedIndex]);

	// Reset hover state when items change
	useEffect(() => {
		setHoveredIndex(null);
	}, [items]);

	if (items.length === 0) {
		return null;
	}

	/**
	 * Get unique ID for an option element.
	 */
	const getOptionId = (index: number): string => {
		return `${dropdownId}-option-${index}`;
	};

	/**
	 * Handle keyboard events on option items.
	 */
	const handleItemKeyDown = (
		event: React.KeyboardEvent,
		item: NoteMetadata | SlashCommand,
	) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect(item);
		}
	};

	/**
	 * Get the hint preview for hover state.
	 */
	const getHintPreview = (index: number): string | null => {
		if (type !== "slash-command") return null;
		const command = items[index] as SlashCommand;
		return command?.hint || null;
	};

	/**
	 * Render a single mention item.
	 */
	const renderMentionItem = (note: NoteMetadata, index: number) => {
		const isSelected = index === selectedIndex;
		const hasBorder = index < items.length - 1;
		const optionId = getOptionId(index);
		const query = searchQuery?.replace(/^@\[\[?/, "") || "";

		return (
			<div
				key={note.path}
				id={optionId}
				role="option"
				aria-selected={isSelected}
				data-index={index}
				className={`suggestion-dropdown-item ${isSelected ? "selected" : ""} ${hasBorder ? "has-border" : ""}`}
				onClick={() => onSelect(note)}
				onKeyDown={(e) => handleItemKeyDown(e, note)}
				onMouseEnter={() => setHoveredIndex(index)}
				onMouseLeave={() => setHoveredIndex(null)}
				tabIndex={isSelected ? 0 : -1}
			>
				<div className="suggestion-dropdown-item-icon">
					<NoteIcon />
				</div>
				<div className="suggestion-dropdown-item-content">
					<div className="suggestion-dropdown-item-name">
						{highlightFuzzyMatch(note.name, query)}
					</div>
					<div className="suggestion-dropdown-item-path">
						{note.path}
					</div>
				</div>
			</div>
		);
	};

	/**
	 * Render a single slash command item.
	 */
	const renderCommandItem = (
		command: SlashCommand,
		index: number,
		isLastInGroup: boolean,
	) => {
		const isSelected = index === selectedIndex;
		const isHovered = index === hoveredIndex;
		const hasBorder = !isLastInGroup;
		const optionId = getOptionId(index);
		const category = command.category || "custom";
		const query = searchQuery?.replace(/^\//, "") || "";

		return (
			<div
				key={command.name}
				id={optionId}
				role="option"
				aria-selected={isSelected}
				data-index={index}
				className={`suggestion-dropdown-item ${isSelected ? "selected" : ""} ${hasBorder ? "has-border" : ""}`}
				onClick={() => onSelect(command)}
				onKeyDown={(e) => handleItemKeyDown(e, command)}
				onMouseEnter={() => setHoveredIndex(index)}
				onMouseLeave={() => setHoveredIndex(null)}
				tabIndex={isSelected ? 0 : -1}
			>
				<div className="suggestion-dropdown-item-icon">
					<CategoryIcon category={category} />
				</div>
				<div className="suggestion-dropdown-item-content">
					<div className="suggestion-dropdown-item-name">
						<span className="command-slash">/</span>
						{highlightFuzzyMatch(command.name, query)}
					</div>
					<div className="suggestion-dropdown-item-description">
						{command.description}
					</div>
				</div>
				{command.hint && (
					<div
						className={`suggestion-dropdown-item-hint-badge ${isSelected || isHovered ? "visible" : ""}`}
					>
						{command.hint}
					</div>
				)}
			</div>
		);
	};

	/**
	 * Render grouped slash commands.
	 */
	const renderGroupedCommands = () => {
		const commands = items as SlashCommand[];
		const groups = groupCommandsByCategory(commands);

		// Build flat index map for tracking global indices
		let globalIndex = 0;
		const indexMap = new Map<SlashCommand, number>();
		for (const category of CATEGORY_ORDER) {
			const categoryCommands = groups.get(category);
			if (categoryCommands && categoryCommands.length > 0) {
				for (const cmd of categoryCommands) {
					indexMap.set(cmd, globalIndex++);
				}
			}
		}

		const result: React.ReactNode[] = [];

		for (const category of CATEGORY_ORDER) {
			const categoryCommands = groups.get(category);
			if (!categoryCommands || categoryCommands.length === 0) {
				continue;
			}

			const meta = CATEGORY_META[category];

			// Only show category headers if there's more than one category
			if (groups.size > 1) {
				result.push(
					<div
						key={`category-${category}`}
						className="suggestion-dropdown-category-header"
						role="presentation"
					>
						<CategoryIcon category={category} />
						<span>{meta.label}</span>
					</div>,
				);
			}

			for (let i = 0; i < categoryCommands.length; i++) {
				const cmd = categoryCommands[i];
				const globalIdx = indexMap.get(cmd)!;
				const isLastInGroup = i === categoryCommands.length - 1;
				result.push(renderCommandItem(cmd, globalIdx, isLastInGroup));
			}
		}

		return result;
	};

	const ariaLabel =
		type === "mention" ? "Note suggestions" : "Command suggestions";
	const activeDescendant =
		selectedIndex >= 0 ? getOptionId(selectedIndex) : undefined;

	// Get current hint for footer display
	const currentHint =
		type === "slash-command"
			? getHintPreview(hoveredIndex ?? selectedIndex)
			: null;

	return (
		<div
			ref={dropdownRef}
			id={dropdownId}
			role="listbox"
			aria-label={ariaLabel}
			aria-activedescendant={activeDescendant}
			className={`suggestion-dropdown ${type === "slash-command" ? "slash-command-dropdown" : "mention-dropdown"}`}
		>
			<div className="suggestion-dropdown-content">
				{type === "mention"
					? (items as NoteMetadata[]).map((item, index) =>
							renderMentionItem(item, index),
						)
					: renderGroupedCommands()}
			</div>

			{/* Hint preview area */}
			{type === "slash-command" && currentHint && (
				<div className="suggestion-dropdown-hint-preview">
					<span className="hint-preview-label">Input:</span>
					<span className="hint-preview-text">{currentHint}</span>
				</div>
			)}

			{/* Keyboard shortcuts footer */}
			<div className="suggestion-dropdown-footer">
				<span className="keyboard-hint">
					<kbd>↑</kbd>
					<kbd>↓</kbd>
					<span>navigate</span>
				</span>
				<span className="keyboard-hint">
					<kbd>Enter</kbd>
					<span>select</span>
				</span>
				<span className="keyboard-hint">
					<kbd>Esc</kbd>
					<span>close</span>
				</span>
			</div>
		</div>
	);
});
