import * as React from "react";
const { useCallback } = React;

export interface CollapsibleToggleProps {
	role: "button";
	tabIndex: 0;
	"aria-expanded": boolean;
	onClick: (event: React.MouseEvent<HTMLElement>) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Props for a header element that toggles a collapsible region.
 *
 * Pointer and keyboard behave the same: click, Enter, or Space toggles
 * (Space is prevented from scrolling the transcript). A click that
 * completed a text selection inside the header is ignored, so copying
 * never yanks the region away. The selection is read from
 * `ownerDocument`, not `activeDocument`: the element may live in a
 * window that does not hold focus (the floating chat).
 */
export function useCollapsibleToggle(
	expanded: boolean,
	onToggle: () => void,
): CollapsibleToggleProps {
	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLElement>) => {
			const selection = event.currentTarget.ownerDocument.getSelection();
			if (
				selection &&
				!selection.isCollapsed &&
				event.currentTarget.contains(selection.anchorNode)
			) {
				return;
			}
			onToggle();
		},
		[onToggle],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLElement>) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			onToggle();
		},
		[onToggle],
	);

	return {
		role: "button",
		tabIndex: 0,
		"aria-expanded": expanded,
		onClick: handleClick,
		onKeyDown: handleKeyDown,
	};
}
