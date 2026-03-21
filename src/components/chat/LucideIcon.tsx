import * as React from "react";
const { useRef, useEffect } = React;
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
