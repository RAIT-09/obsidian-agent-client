import * as React from "react";
import type { TabInfo } from "../../hooks/useTabManager";
import { formatTabTimestamp } from "../../shared/time-utils";

export interface TabBarProps {
	/** All tabs to display */
	tabs: TabInfo[];
	/** Index of the currently active tab */
	activeTabIndex: number;
	/** Called when a tab is clicked */
	onTabClick: (index: number) => void;
	/** Called when a tab's close button is clicked */
	onTabClose?: (index: number) => void;
}

export function TabBar({
	tabs,
	activeTabIndex,
	onTabClick,
	onTabClose,
}: TabBarProps) {
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
						onClick={() => onTabClick(index)}
					>
						<span className="agent-client-tab-label">{label}</span>
						{onTabClose && (
							<button
								className="agent-client-tab-close"
								onClick={(e) => {
									e.stopPropagation();
									onTabClose(index);
								}}
								aria-label="Close tab"
							>
								×
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
