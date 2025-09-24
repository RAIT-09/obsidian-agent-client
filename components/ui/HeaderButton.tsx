import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";

interface HeaderButtonProps {
	iconName: string;
	tooltip: string;
	onClick: () => void;
}

export function HeaderButton({
	iconName,
	tooltip,
	onClick,
}: HeaderButtonProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (buttonRef.current) {
			setIcon(buttonRef.current, iconName);
			const svg = buttonRef.current.querySelector("svg");
			if (svg) {
				svg.style.color = "var(--text-muted)";
			}
		}
	}, [iconName]);

	return (
		<button
			ref={buttonRef}
			title={tooltip}
			onClick={onClick}
			style={{
				width: "20px",
				height: "20px",
				border: "none",
				borderRadius: "0",
				backgroundColor: "transparent",
				color: "var(--text-muted)",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: "16px",
				transition: "all 0.2s ease",
				padding: "0",
				margin: "0",
				outline: "none",
				appearance: "none",
				boxShadow: "none",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.backgroundColor =
					"var(--background-modifier-hover)";
				const svg = e.currentTarget.querySelector("svg");
				if (svg) {
					svg.style.color = "var(--interactive-accent)";
				}
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.backgroundColor = "transparent";
				const svg = e.currentTarget.querySelector("svg");
				if (svg) {
					svg.style.color = "var(--text-muted)";
				}
			}}
		/>
	);
}
