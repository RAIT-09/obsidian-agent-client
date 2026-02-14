import * as React from "react";
import { formatTabTimestamp } from "../../shared/time-utils";

export interface TabBarProps {
	agentLabel: string;
	createdAt: Date;
}

export function TabBar({ agentLabel, createdAt }: TabBarProps) {
	const timestamp = formatTabTimestamp(createdAt);
	const label = `${agentLabel} ${timestamp}`;

	return (
		<div className="agent-client-tab-bar">
			<div className="agent-client-tab agent-client-tab-active">
				<span className="agent-client-tab-label">{label}</span>
			</div>
		</div>
	);
}
