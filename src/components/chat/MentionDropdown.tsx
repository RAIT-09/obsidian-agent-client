import * as React from "react";
const { useRef, useEffect } = React;
import { TFile } from "obsidian";

interface MentionDropdownProps {
	files: TFile[];
	selectedIndex: number;
	onSelect: (file: TFile) => void;
	onClose: () => void;
}

export function MentionDropdown({
	files,
	selectedIndex,
	onSelect,
	onClose,
}: MentionDropdownProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);

	console.log("[DEBUG] MentionDropdown component rendering with:", {
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

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [onClose]);

	if (files.length === 0) {
		return null;
	}

	return (
		<div
			ref={dropdownRef}
			style={{
				// Overlay positioning - positioned above textarea
				position: "absolute",
				bottom: "100%", // Position above the textarea
				left: "0",
				right: "0",
				backgroundColor: "var(--background-secondary)",
				border: "2px solid var(--background-modifier-border)",
				borderRadius: "8px",
				boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
				overflowY: "auto",
				fontSize: "14px",
				marginBottom: "8px", // Space between dropdown and textarea
				zIndex: 1000,
			}}
		>
			{files.map((file, index) => (
				<div
					key={file.path}
					style={{
						padding: "4px 16px",
						cursor: "pointer",
						backgroundColor:
							index === selectedIndex
								? "var(--background-primary)" // More visible selection
								: "transparent",
						borderBottom:
							index < files.length - 1
								? "1px solid var(--background-modifier-border)"
								: "none",
						userSelect: "none",
						transition: "background-color 0.1s ease",
					}}
					onClick={() => onSelect(file)}
					onMouseEnter={() => {
						// Could update selected index on hover, but keeping it keyboard-focused for now
					}}
				>
					<div
						style={{
							fontWeight: "500",
							color: "var(--text-normal)",
							marginBottom: "2px",
						}}
					>
						{file.basename}
					</div>
					<div
						style={{
							fontSize: "12px",
							color: "var(--text-muted)",
							opacity: 0.8,
						}}
					>
						{file.path}
					</div>
				</div>
			))}
		</div>
	);
}
