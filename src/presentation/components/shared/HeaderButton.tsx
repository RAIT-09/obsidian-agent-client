import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";

interface HeaderButtonProps {
	iconName: string;
	tooltip: string;
	onClick: () => void;
	/** Optional custom aria-label (defaults to tooltip) */
	ariaLabel?: string;
}

export const HeaderButton = React.memo(function HeaderButton({
	iconName,
	tooltip,
	onClick,
	ariaLabel,
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
			type="button"
			title={tooltip}
			aria-label={ariaLabel || tooltip}
			onClick={onClick}
			className="header-button"
		/>
	);
});
