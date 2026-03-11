import * as React from "react";
import { useEffect, useRef } from "react";
import { setIcon } from "obsidian";

interface AgentIconProps {
	agentLabel: string;
}

/**
 * Renders an adaptive, monochromatic icon based on the agent label.
 * - Claude Code -> asterisk (✳ Eight-spoked asterisk)
 * - Gemini CLI -> sparkle (✦)
 * - Codex CLI -> terminal
 * - Others -> bot (default)
 */
export function AgentIcon({ agentLabel }: AgentIconProps) {
	const iconRef = useRef<HTMLSpanElement>(null);

	const getIconName = (label: string): string => {
		const lowerLabel = label.toLowerCase();
		if (lowerLabel.includes("claude")) return "asterisk";
		if (lowerLabel.includes("gemini")) return "sparkle";
		if (lowerLabel.includes("codex")) return "terminal";
		return "bot";
	};

	useEffect(() => {
		if (iconRef.current) {
			const iconName = getIconName(agentLabel);
			setIcon(iconRef.current, iconName);
		}
	}, [agentLabel]);

	return (
		<span 
			ref={iconRef} 
			className="agent-client-agent-icon"
			style={{ 
				display: "inline-flex", 
				alignItems: "center", 
				justifyContent: "center",
				marginRight: "6px",
				opacity: 0.8
			}}
		/>
	);
}
