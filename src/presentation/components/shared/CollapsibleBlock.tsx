import * as React from "react";
const { useState, useEffect, useRef } = React;
import { setIcon } from "obsidian";

export interface CollapsibleBlockProps {
	icon: string;
	label: string;
	meta?: string;
	defaultExpanded?: boolean;
	variant?: "default" | "subtle";
	children: React.ReactNode;
}

export const CollapsibleBlock: React.FC<CollapsibleBlockProps> = ({
	icon,
	label,
	meta,
	defaultExpanded = false,
	variant = "default",
	children,
}) => {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded);
	const iconRef = useRef<HTMLSpanElement>(null);
	const chevronRef = useRef<HTMLSpanElement>(null);
	const contentId = useRef(`collapsible-content-${Math.random().toString(36).slice(2, 9)}`);

	useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, icon);
		}
	}, [icon]);

	useEffect(() => {
		if (chevronRef.current) {
			setIcon(chevronRef.current, "chevron-down");
		}
	}, []);

	const handleToggle = () => {
		setIsExpanded(!isExpanded);
	};

	const blockClasses = [
		"collapsible-block",
		isExpanded ? "expanded" : "",
		variant === "subtle" ? "collapsible-block-subtle" : "",
	].filter(Boolean).join(" ");

	return (
		<div className={blockClasses}>
			<button
				type="button"
				className="collapsible-block-header"
				onClick={handleToggle}
				aria-expanded={isExpanded}
				aria-controls={contentId.current}
			>
				<span
					ref={iconRef}
					className="collapsible-block-icon"
					aria-hidden="true"
				/>
				<span className="collapsible-block-label">{label}</span>
				{meta && <span className="collapsible-block-meta">{meta}</span>}
				<span
					ref={chevronRef}
					className="collapsible-block-chevron"
					aria-hidden="true"
				/>
			</button>
			<div className="collapsible-block-content-wrapper">
				<div
					id={contentId.current}
					className="collapsible-block-content"
					aria-hidden={!isExpanded}
				>
					<div className="collapsible-block-content-inner">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
};
