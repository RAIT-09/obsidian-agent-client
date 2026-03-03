import { Platform } from "obsidian";
import * as React from "react";
import type { ChatInputState } from "../../domain/models/chat-input-state";
import { useSettings } from "../../hooks/useSettings";
import { useTabs } from "../../hooks/useTabs";
import { useUpdateCheck } from "../../hooks/useUpdateCheck";
import { useWorkspaceEvents } from "../../hooks/useWorkspaceEvents";
import type AgentClientPlugin from "../../plugin";
import { resolveAgentDisplayName } from "../../shared/agent-display-name";
import { playCompletionSound } from "../../shared/completion-sound";
import { getLogger } from "../../shared/logger";
import { ChatHeader } from "./ChatHeader";
import { TabContent, type TabContentActions } from "./TabContent";
import type { ChatView } from "./ChatView";

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

interface ChatViewComponentProps {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
}

export function ChatViewComponent({
	plugin,
	view,
	viewId,
}: ChatViewComponentProps) {
	if (!Platform.isDesktopApp) {
		throw new Error("Obsius is only available on desktop");
	}

	const logger = getLogger();
	const settings = useSettings(plugin);

	const [restoredAgentId, setRestoredAgentId] = React.useState<
		string | undefined
	>(view.getInitialAgentId() ?? undefined);

	const availableAgents = React.useMemo(() => {
		return plugin.getAvailableAgents();
	}, [plugin]);

	const isUpdateAvailable = useUpdateCheck(plugin);

	React.useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			logger.log(`[ChatView] Agent ID restored from workspace: ${agentId}`);
			setRestoredAgentId(agentId);
		});
		return unsubscribe;
	}, [view, logger]);

	React.useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = view.containerEl;
		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, view.containerEl]);

	const handleTabClose = React.useCallback(
		(tabId: string) => {
			void plugin.removeSessionAdapter(tabId);
			view.unregisterTabAdapter(tabId);
		},
		[plugin, view],
	);

	const tabState = useTabs({
		initialAgentId: restoredAgentId || plugin.settings.defaultAgentId,
		defaultAgentId: plugin.settings.defaultAgentId,
		availableAgents,
		onTabClose: handleTabClose,
	});

	const tabActionsMapRef = React.useRef<Map<string, TabContentActions>>(
		new Map(),
	);
	const [activeTabCanShowHistory, setActiveTabCanShowHistory] =
		React.useState(false);

	const handleActionsReady = React.useCallback(
		(tabId: string, actions: TabContentActions | null) => {
			if (actions) {
				tabActionsMapRef.current.set(tabId, actions);
			} else {
				tabActionsMapRef.current.delete(tabId);
			}
			if (tabId === tabState.activeTabId) {
				setActiveTabCanShowHistory(actions?.canShowSessionHistory ?? false);
			}
		},
		[tabState.activeTabId],
	);

	React.useEffect(() => {
		const actions = tabActionsMapRef.current.get(tabState.activeTabId);
		setActiveTabCanShowHistory(actions?.canShowSessionHistory ?? false);
	}, [tabState.activeTabId]);

	React.useEffect(() => {
		for (const tab of tabState.tabs) {
			view.registerTabAdapter(tab.id);
		}
	}, [tabState.tabs, view]);

	const activeAgentLabel = React.useMemo(
		() => resolveAgentDisplayName(plugin.settings, tabState.activeTab.agentId),
		[tabState.activeTab.agentId, plugin.settings],
	);

	const handleOpenSettings = React.useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleNewSession = React.useCallback(() => {
		const actions = tabActionsMapRef.current.get(tabState.activeTabId);
		if (actions) {
			void actions.handleNewChat();
		}
	}, [tabState.activeTabId]);

	const handleOpenHistory = React.useCallback(() => {
		const actions = tabActionsMapRef.current.get(tabState.activeTabId);
		if (actions) {
			actions.handleOpenHistory();
		}
	}, [tabState.activeTabId]);

	const handleAgentChangeForTab = React.useCallback(
		(agentId: string) => {
			tabState.handleAgentChangeForTab(agentId);
			view.setAgentId(agentId);
		},
		[tabState, view],
	);

	const handleSendComplete = React.useCallback(
		(tabId: string) => {
			tabState.markTabCompleted(tabId);
			if (settings.displaySettings.completionSound) {
				playCompletionSound();
			}
		},
		[tabState.markTabCompleted, settings.displaySettings.completionSound],
	);

	const wsAutoMentionToggle = React.useCallback(
		(force?: boolean) => {
			tabActionsMapRef.current
				.get(tabState.activeTabId)
				?.autoMentionToggle(force);
		},
		[tabState.activeTabId],
	);

	const wsHandleNewChat = React.useCallback(
		(agentId?: string) => {
			const actions = tabActionsMapRef.current.get(tabState.activeTabId);
			if (actions) void actions.handleNewChat(agentId);
		},
		[tabState.activeTabId],
	);

	const wsApprovePermission = React.useCallback(async () => {
		return (
			(await tabActionsMapRef.current
				.get(tabState.activeTabId)
				?.approveActivePermission()) ?? false
		);
	}, [tabState.activeTabId]);

	const wsRejectPermission = React.useCallback(async () => {
		return (
			(await tabActionsMapRef.current
				.get(tabState.activeTabId)
				?.rejectActivePermission()) ?? false
		);
	}, [tabState.activeTabId]);

	const wsStopGeneration = React.useCallback(async () => {
		await tabActionsMapRef.current
			.get(tabState.activeTabId)
			?.handleStopGeneration();
	}, [tabState.activeTabId]);

	useWorkspaceEvents({
		workspace: plugin.app.workspace,
		viewId,
		lastActiveChatViewId: plugin.lastActiveChatViewId,
		autoMentionToggle: wsAutoMentionToggle,
		handleNewChat: wsHandleNewChat,
		approveActivePermission: wsApprovePermission,
		rejectActivePermission: wsRejectPermission,
		handleStopGeneration: wsStopGeneration,
	});

	React.useEffect(() => {
		const getActiveActions = () =>
			tabActionsMapRef.current.get(tabState.activeTabId);

		view.registerInputCallbacks({
			getDisplayName: () =>
				getActiveActions()?.getDisplayName() ?? activeAgentLabel,
			getInputState: () => getActiveActions()?.getInputState() ?? null,
			setInputState: (state: ChatInputState) =>
				getActiveActions()?.setInputState(state),
			addContextReference: (reference) =>
				getActiveActions()?.addContextReference(reference) ?? false,
			sendMessage: async () =>
				(await getActiveActions()?.sendMessage()) ?? false,
			canSend: () => getActiveActions()?.canSend() ?? false,
			cancel: async () => {
				await getActiveActions()?.cancel();
			},
			getLastAssistantText: () =>
				getActiveActions()?.getLastAssistantText?.() ?? null,
		});

		return () => {
			view.unregisterInputCallbacks();
		};
	}, [view, tabState.activeTabId, activeAgentLabel]);

	return (
		<div className="obsius-chat-view-container">
			<ChatHeader
				agentLabel={activeAgentLabel}
				availableAgents={availableAgents}
				currentAgentId={tabState.activeTab.agentId}
				isUpdateAvailable={isUpdateAvailable}
				onAgentChange={handleAgentChangeForTab}
				onNewTab={tabState.handleNewTab}
				onNewSession={handleNewSession}
				onOpenSettings={handleOpenSettings}
				onOpenHistory={activeTabCanShowHistory ? handleOpenHistory : undefined}
				tabs={tabState.tabsWithLabels}
				activeTabId={tabState.activeTabId}
				completedTabIds={tabState.completedTabIds}
				canAddTab={tabState.canAddTab}
				canCloseTab={tabState.canCloseTab}
				onTabClick={tabState.handleTabClick}
				onTabClose={tabState.handleTabClose}
			/>

			{tabState.tabs.map((tab) => (
				<TabContent
					key={tab.id}
					plugin={plugin}
					view={view}
					tabId={tab.id}
					agentId={tab.agentId}
					isActive={tab.id === tabState.activeTabId}
					viewId={viewId}
					onActionsReady={handleActionsReady}
					onSendComplete={handleSendComplete}
				/>
			))}
		</div>
	);
}
