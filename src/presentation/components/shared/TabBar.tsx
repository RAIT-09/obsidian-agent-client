// src/presentation/components/shared/TabBar.tsx

import * as React from 'react';
import { setIcon } from 'obsidian';
import './tab-bar.css';

export type TabId = 'chat' | 'terminal' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { id: 'chat', label: 'Chat', icon: 'message-square', shortcut: 'Mod+1' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', shortcut: 'Mod+2' },
  { id: 'settings', label: 'Settings', icon: 'settings', shortcut: 'Mod+3' },
];

export interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  terminalStatus?: 'idle' | 'running' | 'starting' | 'error';
  settingsDirty?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  terminalStatus = 'idle',
  settingsDirty = false,
}) => {
  return (
    <div className="tab-bar" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          title={`${tab.label} (${tab.shortcut})`}
        >
          <span
            ref={(el) => {
              if (el) setIcon(el, tab.icon);
            }}
          />
          <span>{tab.label}</span>
          {tab.id === 'terminal' && terminalStatus === 'running' && (
            <span className="status-dot running" />
          )}
          {tab.id === 'settings' && settingsDirty && (
            <span className="status-dot dirty" />
          )}
        </button>
      ))}
    </div>
  );
};
