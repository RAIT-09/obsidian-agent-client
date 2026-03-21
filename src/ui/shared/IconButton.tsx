import * as React from "react";
const { useRef, useEffect, useImperativeHandle, forwardRef } = React;
import { setIcon } from "obsidian";

/**
 * Renders an Obsidian Lucide icon via setIcon().
 * Used as a replacement for emoji icons to match Obsidian's native UI.
 */
export function LucideIcon({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, name);
		}
	}, [name]);

	return <span ref={ref} className={className} />;
}

interface HeaderButtonProps {
	iconName: string;
	tooltip: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const HeaderButton = forwardRef<HTMLButtonElement, HeaderButtonProps>(
	function HeaderButton({ iconName, tooltip, onClick }, ref) {
		const buttonRef = useRef<HTMLButtonElement>(null);

		// Expose the button ref to parent components
		useImperativeHandle(ref, () => buttonRef.current!, []);

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
				className="clickable-icon agent-client-header-button"
			/>
		);
	},
);
