import * as React from "react";
const { useState } = React;

interface CollapsibleSectionProps {
	className?: string;
	header: React.ReactNode;
	defaultExpanded?: boolean;
	collapsible?: boolean;
	children: React.ReactNode;
}

export function CollapsibleSection({
	className,
	header,
	defaultExpanded = false,
	collapsible = true,
	children,
}: CollapsibleSectionProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const isExpanded = collapsible && expanded;

	return (
		<div
			className={`ac-collapsible ${isExpanded ? "ac-collapsible--expanded" : ""} ${!collapsible ? "ac-collapsible--static" : ""} ${className ?? ""}`}
		>
			<div
				className="ac-collapsible__header"
				role={collapsible ? "button" : undefined}
				tabIndex={collapsible ? 0 : undefined}
				aria-expanded={collapsible ? isExpanded : undefined}
				onClick={
					collapsible
						? () => setExpanded((v) => !v)
						: undefined
				}
				onKeyDown={(e) => {
					if (!collapsible) return;
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setExpanded((v) => !v);
					}
				}}
			>
				{header}
			</div>
			{isExpanded && <div className="ac-collapsible__body">{children}</div>}
		</div>
	);
}
