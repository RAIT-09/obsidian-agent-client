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
		}
	}, [iconName]);

	return (
		<button
			ref={buttonRef}
			title={tooltip}
			onClick={onClick}
			className="agent-client-header-button"
		/>
	);
}
