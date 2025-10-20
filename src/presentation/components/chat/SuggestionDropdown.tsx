import * as React from "react";
const { useRef, useEffect, useMemo } = React;
import { Logger } from "../../../shared/logger";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { ChatView } from "../../views/chat/ChatView";
import type { NoteMetadata } from "../../../core/domain/ports/vault-access.port";
import type { SlashCommand } from "../../../core/domain/models/chat-session";

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
}

/**
 * Generic suggestion dropdown component.
 *
 * Displays either:
 * - Note mentions (@[[note]])
 * - Slash commands (/command)
 *
 * Handles keyboard navigation, mouse selection, and outside click detection.
 */
export function SuggestionDropdown({
	type,
	items,
	selectedIndex,
	onSelect,
	onClose,
	plugin,
	view,
}: SuggestionDropdownProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	logger.log(`[DEBUG] SuggestionDropdown (${type}) rendering with:`, {
		itemsCount: items.length,
		selectedIndex,
	});

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

	if (items.length === 0) {
		return null;
	}

	/**
	 * Render a single dropdown item based on type.
	 */
	const renderItem = (item: NoteMetadata | SlashCommand, index: number) => {
		const isSelected = index === selectedIndex;
		const hasBorder = index < items.length - 1;

		if (type === "mention") {
			const note = item as NoteMetadata;
			return (
				<div
					key={note.path}
					className={`mention-dropdown-item ${isSelected ? "selected" : ""} ${hasBorder ? "has-border" : ""}`}
					onClick={() => onSelect(note)}
					onMouseEnter={() => {
						// Could update selected index on hover
					}}
				>
					<div className="mention-dropdown-item-name">
						{note.name}
					</div>
					<div className="mention-dropdown-item-path">
						{note.path}
					</div>
				</div>
			);
		} else {
			// type === "slash-command"
			const command = item as SlashCommand;
			return (
				<div
					key={command.name}
					className={`mention-dropdown-item ${isSelected ? "selected" : ""} ${hasBorder ? "has-border" : ""}`}
					onClick={() => onSelect(command)}
					onMouseEnter={() => {
						// Could update selected index on hover
					}}
				>
					<div className="mention-dropdown-item-name">
						/{command.name}
					</div>
					<div className="mention-dropdown-item-path">
						{command.description}
						{command.hint && ` (${command.hint})`}
					</div>
				</div>
			);
		}
	};

	return (
		<div ref={dropdownRef} className="mention-dropdown">
			{items.map((item, index) => renderItem(item, index))}
		</div>
	);
}
