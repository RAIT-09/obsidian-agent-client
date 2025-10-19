import * as React from "react";
const { useRef, useEffect, useMemo } = React;
import { Logger } from "../../utils/logger";
import type AgentClientPlugin from "../../main";
import type { ChatView } from "../../ChatView";
import type { NoteMetadata } from "../../ports/vault-access.port";

interface MentionDropdownProps {
	files: NoteMetadata[];
	selectedIndex: number;
	onSelect: (file: NoteMetadata) => void;
	onClose: () => void;
	plugin: AgentClientPlugin;
	view: ChatView;
}

export function MentionDropdown({
	files,
	selectedIndex,
	onSelect,
	onClose,
	plugin,
	view,
}: MentionDropdownProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	logger.log("[DEBUG] MentionDropdown component rendering with:", {
		files: files.map((f) => f.name),
		selectedIndex,
		filesCount: files.length,
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
	}, [onClose]);

	if (files.length === 0) {
		return null;
	}

	return (
		<div ref={dropdownRef} className="mention-dropdown">
			{files.map((file, index) => (
				<div
					key={file.path}
					className={`mention-dropdown-item ${index === selectedIndex ? "selected" : ""} ${index < files.length - 1 ? "has-border" : ""}`}
					onClick={() => onSelect(file)}
					onMouseEnter={() => {
						// Could update selected index on hover, but keeping it keyboard-focused for now
					}}
				>
					<div className="mention-dropdown-item-name">
						{file.name}
					</div>
					<div className="mention-dropdown-item-path">
						{file.path}
					</div>
				</div>
			))}
		</div>
	);
}
