import type { App } from "obsidian";

export type UiLanguage = "en" | "zh";

type TranslationKey = keyof typeof TRANSLATIONS;

type TranslationParams = Record<string, string | number>;

const TRANSLATIONS = {
	pluginUpdateAvailable: {
		en: "Plugin update available!",
		zh: "插件有可用更新！",
	},
	newChat: { en: "New chat", zh: "新建聊天" },
	sessionHistory: { en: "Session history", zh: "会话历史" },
	exportChatToMarkdown: {
		en: "Export chat to Markdown",
		zh: "导出聊天到 Markdown",
	},
	more: { en: "More", zh: "更多" },
	status: { en: "Status", zh: "状态" },
	newSession: { en: "New session", zh: "新建会话" },
	openNewFloatingChat: {
		en: "Open new floating chat",
		zh: "打开新的悬浮聊天",
	},
	close: { en: "Close", zh: "关闭" },
	switchAgent: { en: "Switch agent", zh: "切换代理" },
	openNewView: { en: "Open new view", zh: "打开新视图" },
	restartAgent: { en: "Restart agent", zh: "重启代理" },
	pluginSettings: { en: "Plugin settings", zh: "插件设置" },
	noActivePermissionRequest: {
		en: "[Agent Client] No active permission request",
		zh: "[Agent Client] 当前没有待处理的权限请求",
	},
	messagePlaceholderWithCommands: {
		en: "Message {{agent}} - @ to mention notes, / for commands",
		zh: "给 {{agent}} 发送消息 - 输入 @ 引用笔记，输入 / 使用命令",
	},
	messagePlaceholderNoCommands: {
		en: "Message {{agent}} - @ to mention notes",
		zh: "给 {{agent}} 发送消息 - 输入 @ 引用笔记",
	},
	enableAutoMention: { en: "Enable auto-mention", zh: "启用自动引用" },
	disableAutoMentionTemporarily: {
		en: "Temporarily disable auto-mention",
		zh: "临时禁用自动引用",
	},
	selectMode: { en: "Select mode", zh: "选择模式" },
	selectModel: { en: "Select model", zh: "选择模型" },
	connecting: { en: "Connecting...", zh: "连接中..." },
	stopGeneration: { en: "Stop generation", zh: "停止生成" },
	sendMessage: { en: "Send message", zh: "发送消息" },
	maxImagesAllowed: {
		en: "[Agent Client] Maximum {{count}} images allowed",
		zh: "[Agent Client] 最多允许 {{count}} 张图片",
	},
	imageTooLarge: {
		en: "[Agent Client] Image too large (max {{size}}MB)",
		zh: "[Agent Client] 图片过大（最大 {{size}}MB）",
	},
	failedAttachImage: {
		en: "[Agent Client] Failed to attach image",
		zh: "[Agent Client] 添加图片失败",
	},
	agentNoImageSupport: {
		en: "[Agent Client] This agent does not support image attachments",
		zh: "[Agent Client] 当前代理不支持图片附件",
	},
	modalSessionHistoryTitle: { en: "Session history", zh: "会话历史" },
	debugManualSessionInput: {
		en: "Debug: Manual Session Input",
		zh: "调试：手动输入会话",
	},
	sessionId: { en: "Session ID:", zh: "会话 ID：" },
	workingDirectory: {
		en: "Working Directory (cwd):",
		zh: "工作目录（cwd）：",
	},
	enterSessionId: { en: "Enter session ID...", zh: "输入会话 ID..." },
	enterWorkingDirectory: {
		en: "Enter working directory...",
		zh: "输入工作目录...",
	},
	restore: { en: "Restore", zh: "恢复" },
	fork: { en: "Fork", zh: "分叉" },
	restoreSession: { en: "Restore session", zh: "恢复会话" },
	forkSessionCreateBranch: {
		en: "Fork session (create new branch)",
		zh: "分叉会话（创建新分支）",
	},
	deleteSession: { en: "Delete session", zh: "删除会话" },
	preparingAgent: { en: "Preparing agent...", zh: "正在准备代理..." },
	agentNoSessionRestore: {
		en: "This agent does not support session restoration.",
		zh: "当前代理不支持恢复会话。",
	},
	sessionsSavedInPlugin: {
		en: "These sessions are saved in the plugin.",
		zh: "这些会话保存在插件中。",
	},
	sessionListUnavailable: {
		en: "Session list is not available for this agent.",
		zh: "当前代理不可用会话列表。",
	},
	enableDebugModeManualSession: {
		en: "Enable Debug Mode in settings to manually enter session IDs.",
		zh: "在设置中启用调试模式后可手动输入会话 ID。",
	},
	showCurrentVaultOnly: {
		en: "Show current vault only",
		zh: "仅显示当前库",
	},
	hideSessionsWithoutLocalData: {
		en: "Hide sessions without local data",
		zh: "隐藏没有本地数据的会话",
	},
	retry: { en: "Retry", zh: "重试" },
	loadingSessions: { en: "Loading sessions...", zh: "正在加载会话..." },
	noPreviousSessions: { en: "No previous sessions", zh: "暂无历史会话" },
	loading: { en: "Loading...", zh: "加载中..." },
	loadMore: { en: "Load more", zh: "加载更多" },
	justNow: { en: "just now", zh: "刚刚" },
	minutesAgo: { en: "{{count}} minutes ago", zh: "{{count}} 分钟前" },
	minuteAgo: { en: "1 minute ago", zh: "1 分钟前" },
	hoursAgo: { en: "{{count}} hours ago", zh: "{{count}} 小时前" },
	hourAgo: { en: "1 hour ago", zh: "1 小时前" },
	yesterday: { en: "yesterday", zh: "昨天" },
	daysAgo: { en: "{{count}} days ago", zh: "{{count}} 天前" },
	untitledSession: { en: "Untitled Session", zh: "未命名会话" },
	deleteSessionConfirmTitle: { en: "Delete session?", zh: "删除会话？" },
	deleteSessionConfirmMessage: {
		en: 'Are you sure you want to delete "{{title}}"?',
		zh: '确定要删除 "{{title}}" 吗？',
	},
	deleteSessionWarning: {
		en: "This only removes the session from this plugin. The session data will remain on the agent side.",
		zh: "这只会从本插件中移除会话，代理侧的会话数据仍会保留。",
	},
	cancel: { en: "Cancel", zh: "取消" },
	delete: { en: "Delete", zh: "删除" },
	openChat: { en: "Open chat", zh: "打开聊天" },
	selectSessionToOpen: {
		en: "Select session to open",
		zh: "选择要打开的会话",
	},
	closeSession: { en: "Close session", zh: "关闭会话" },
	attachedImage: { en: "Attached image", zh: "已附加图片" },
	removeImage: { en: "Remove image", zh: "移除图片" },
	plan: { en: "Plan", zh: "计划" },
	unsupportedContentType: {
		en: "Unsupported content type",
		zh: "不支持的内容类型",
	},
	permissionSelected: {
		en: "Selected: {{option}}",
		zh: "已选择：{{option}}",
	},
	permissionRequestCancelled: {
		en: "Cancelled: Permission request was cancelled",
		zh: "已取消：权限请求已被取消",
	},
	restoringSession: { en: "Restoring session...", zh: "正在恢复会话..." },
	connectingToAgent: {
		en: "Connecting to {{agent}}...",
		zh: "正在连接 {{agent}}...",
	},
	startConversationWithAgent: {
		en: "Start a conversation with {{agent}}...",
		zh: "开始与 {{agent}} 对话...",
	},
	newFile: { en: "New file", zh: "新文件" },
	moreLines: { en: "{{count}} more lines", zh: "还有 {{count}} 行" },
	collapse: { en: "Collapse", zh: "折叠" },
	agentClientDisplayName: { en: "Agent client", zh: "代理客户端" },
	chatDisplayName: { en: "Chat", zh: "聊天" },
	permissionErrorTitle: { en: "Permission Error", zh: "权限错误" },
	failedRespondPermission: {
		en: "Failed to respond to permission request: {{error}}",
		zh: "响应权限请求失败：{{error}}",
	},
	ribbonOpenAgentClient: { en: "Open agent client", zh: "打开代理客户端" },
	commandOpenAgentChat: { en: "Open agent chat", zh: "打开代理聊天" },
	commandFocusNextChatView: {
		en: "Focus next chat view",
		zh: "聚焦下一个聊天视图",
	},
	commandFocusPreviousChatView: {
		en: "Focus previous chat view",
		zh: "聚焦上一个聊天视图",
	},
	commandOpenNewChatView: { en: "Open new chat view", zh: "打开新聊天视图" },
	commandOpenFloatingChatWindow: {
		en: "Open floating chat window",
		zh: "打开悬浮聊天窗口",
	},
	commandOpenNewFloatingChatWindow: {
		en: "Open new floating chat window",
		zh: "打开新的悬浮聊天窗口",
	},
	commandCloseFloatingChatWindow: {
		en: "Close floating chat window",
		zh: "关闭悬浮聊天窗口",
	},
	commandNewChatWithAgent: {
		en: "New chat with {{agent}}",
		zh: "与 {{agent}} 新建聊天",
	},
	commandApproveActivePermission: {
		en: "Approve active permission",
		zh: "批准当前权限请求",
	},
	commandRejectActivePermission: {
		en: "Reject active permission",
		zh: "拒绝当前权限请求",
	},
	commandToggleAutoMention: { en: "Toggle auto-mention", zh: "切换自动引用" },
	commandCancelCurrentMessage: {
		en: "Cancel current message",
		zh: "取消当前消息",
	},
	commandBroadcastPrompt: { en: "Broadcast prompt", zh: "广播提示词" },
	commandBroadcastSend: { en: "Broadcast send", zh: "广播发送" },
	commandBroadcastCancel: { en: "Broadcast cancel", zh: "广播取消" },
	closeError: { en: "Close error", zh: "关闭错误" },
	terminal: { en: "Terminal", zh: "终端" },
	running: { en: "RUNNING", zh: "运行中" },
	cancelled: { en: "CANCELLED", zh: "已取消" },
	finished: { en: "FINISHED", zh: "已完成" },
	waitingForOutput: { en: "Waiting for output...", zh: "等待输出中..." },
	noOutput: { en: "No output", zh: "无输出" },
	exitCode: { en: "Exit Code", zh: "退出码" },
	signal: { en: "Signal", zh: "信号" },
	noChatViewsOpen: {
		en: "[Agent Client] No chat views open",
		zh: "[Agent Client] 没有打开的聊天视图",
	},
	noPromptToBroadcast: {
		en: "[Agent Client] No prompt to broadcast",
		zh: "[Agent Client] 没有可广播的提示内容",
	},
	noOtherChatViewsToBroadcast: {
		en: "[Agent Client] No other chat views to broadcast to",
		zh: "[Agent Client] 没有其他可广播的聊天视图",
	},
	noViewsReadyToSend: {
		en: "[Agent Client] No views ready to send",
		zh: "[Agent Client] 没有可发送消息的视图",
	},
	cancelBroadcastToAllViews: {
		en: "[Agent Client] Cancel broadcast to all views",
		zh: "[Agent Client] 已向所有视图广播取消",
	},
	updateAvailableVersion: {
		en: "[Agent Client] Update available: v{{version}}",
		zh: "[Agent Client] 有可用更新：v{{version}}",
	},
	alreadyNewSession: {
		en: "[Agent Client] Already a new session",
		zh: "[Agent Client] 当前已是新会话",
	},
	noMessagesToExport: {
		en: "[Agent Client] No messages to export",
		zh: "[Agent Client] 没有可导出的消息",
	},
	chatExportedTo: {
		en: "[Agent Client] Chat exported to {{path}}",
		zh: "[Agent Client] 聊天已导出到 {{path}}",
	},
	failedExportChat: {
		en: "[Agent Client] Failed to export chat",
		zh: "[Agent Client] 导出聊天失败",
	},
	agentRestarted: {
		en: "[Agent Client] Agent restarted",
		zh: "[Agent Client] 代理已重启",
	},
	failedRestartAgent: {
		en: "[Agent Client] Failed to restart agent",
		zh: "[Agent Client] 重启代理失败",
	},
	sessionRestored: {
		en: "[Agent Client] Session restored",
		zh: "[Agent Client] 会话已恢复",
	},
	failedRestoreSession: {
		en: "[Agent Client] Failed to restore session",
		zh: "[Agent Client] 恢复会话失败",
	},
	sessionForked: {
		en: "[Agent Client] Session forked",
		zh: "[Agent Client] 会话已分叉",
	},
	failedForkSession: {
		en: "[Agent Client] Failed to fork session",
		zh: "[Agent Client] 分叉会话失败",
	},
	sessionDeleted: {
		en: "[Agent Client] Session deleted",
		zh: "[Agent Client] 会话已删除",
	},
	failedDeleteSession: {
		en: "[Agent Client] Failed to delete session",
		zh: "[Agent Client] 删除会话失败",
	},
	cannotSendMessageNoSession: {
		en: "No active session. Please wait for connection.",
		zh: "没有活动的会话。请等待连接。",
	},
	sendMessageFailed: {
		en: "Send Message Failed",
		zh: "发送消息失败",
	},
	sendMessageFailedDetail: {
		en: "Failed to send message",
		zh: "发送消息失败",
	},
	sessionRestorationNotSupported: {
		en: "Session restoration is not supported",
		zh: "不支持恢复会话",
	},
	session: {
		en: "Session",
		zh: "会话",
	},
	forkPrefix: {
		en: "Fork: ",
		zh: "分叉：",
	},
	agentNotFound: {
		en: "Agent Not Found",
		zh: "未找到代理",
	},
	checkAgentConfigSettings: {
		en: "Please check your agent configuration in settings.",
		zh: "请在设置中检查您的代理配置。",
	},
	sessionCreationFailed: {
		en: "Session Creation Failed",
		zh: "创建会话失败",
	},
	checkAgentConfigTryAgain: {
		en: "Please check the agent configuration and try again.",
		zh: "请检查代理配置后重试。",
	},
	sessionLoadingFailed: {
		en: "Session Loading Failed",
		zh: "加载会话失败",
	},
	tryAgainOrNewSession: {
		en: "Please try again or create a new session.",
		zh: "请重试或创建新会话。",
	},
	agentError: {
		en: "Agent Error",
		zh: "代理错误",
	},
	anErrorOccurred: {
		en: "An error occurred",
		zh: "发生错误",
	},
	desktopOnly: {
		en: "Agent Client is only available on desktop",
		zh: "代理客户端仅在桌面端可用",
	},
} as const;

function format(template: string, params?: TranslationParams): string {
	if (!params) {
		return template;
	}
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
		const value = params[key];
		return value === undefined ? "" : String(value);
	});
}

export function getUiLanguage(app: App): UiLanguage {
	const appAny = app as unknown as {
		locale?: string;
		vault?: { getConfig?: (key: string) => unknown };
	};

	const candidate =
		(typeof appAny.locale === "string" && appAny.locale) ||
		(typeof appAny.vault?.getConfig === "function"
			? (appAny.vault.getConfig("locale") as string | undefined)
			: undefined) ||
		navigator.language;

	if (
		typeof candidate === "string" &&
		candidate.toLowerCase().startsWith("zh")
	) {
		return "zh";
	}

	return "en";
}

export function t(
	language: UiLanguage,
	key: TranslationKey,
	params?: TranslationParams,
): string {
	return format(TRANSLATIONS[key][language], params);
}

export function tApp(
	app: App,
	key: TranslationKey,
	params?: TranslationParams,
): string {
	return t(getUiLanguage(app), key, params);
}
