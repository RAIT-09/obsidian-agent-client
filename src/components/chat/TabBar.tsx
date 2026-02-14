import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type { TabInfo } from "../../hooks/useTabManager";
import { formatTabTimestamp } from "../../shared/time-utils";

export interface TabBarProps {
	/** All tabs to display */
	tabs: TabInfo[];
	/** Index of the currently active tab */
	activeTabIndex: number;
	/** Callback to create a new tab */
	onCreateTab: () => void;
}

export function TabBar({ tabs, activeTabIndex, onCreateTab }: TabBarProps) {
	const addButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (addButtonRef.current) {
			setIcon(addButtonRef.current, "plus");
		}
	}, []);

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
			<button
				ref={addButtonRef}
				className="agent-client-tab-add-button"
				onClick={onCreateTab}
				title="New tab"
			/>
		</div>
	);
}
