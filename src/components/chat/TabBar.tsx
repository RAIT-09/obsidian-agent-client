import * as React from "react";
import type { TabInfo } from "../../hooks/useTabManager";
import { formatTabTimestamp } from "../../shared/time-utils";

export interface TabBarProps {
	/** All tabs to display */
	tabs: TabInfo[];
	/** Index of the currently active tab */
	activeTabIndex: number;
}

export function TabBar({ tabs, activeTabIndex }: TabBarProps) {
	return (
		<div className="agent-client-tab-bar">
			{tabs.map((tab, index) => {
				const timestamp = formatTabTimestamp(tab.createdAt);
				const label = `${tab.agentLabel} ${timestamp}`;
				const isActive = index === activeTabIndex;

				return (
					<div
						key={tab.tabId}
						className={`agent-client-tab${isActive ? " agent-client-tab-active" : ""}`}
					>
						<span className="agent-client-tab-label">{label}</span>
					</div>
				);
			})}
		</div>
	);
}
