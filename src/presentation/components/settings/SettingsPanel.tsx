// src/presentation/components/settings/SettingsPanel.tsx

import * as React from "react";
const { useState, useEffect, useCallback } = React;
import { setIcon, Notice } from "obsidian";

import {
	ClaudeConfigService,
	type ClaudeSettings,
	type ClaudeModel,
	DEFAULT_CLAUDE_SETTINGS,
} from "../../../adapters/claude-config";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";

export interface SettingsPanelProps {
	plugin: AgentClientPlugin;
	configService: ClaudeConfigService;
	onDirtyChange: (dirty: boolean) => void;
}

const MODEL_OPTIONS: { id: ClaudeModel; label: string; description: string }[] =
	[
		{
			id: "claude-opus-4-20250514",
			label: "Opus 4",
			description: "Most capable",
		},
		{
			id: "claude-sonnet-4-20250514",
			label: "Sonnet 4",
			description: "Balanced",
		},
		{
			id: "claude-3-5-sonnet-20241022",
			label: "Sonnet 3.5",
			description: "Previous generation",
		},
		{
			id: "claude-3-5-haiku-20241022",
			label: "Haiku 3.5",
			description: "Fastest",
		},
	];

interface AddMcpFormState {
	name: string;
	command: string;
	args: string;
}

const INITIAL_MCP_FORM: AddMcpFormState = {
	name: "",
	command: "",
	args: "",
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
	plugin,
	configService,
	onDirtyChange,
}) => {
	const [settings, setSettings] = useState<ClaudeSettings | null>(null);
	const [originalSettings, setOriginalSettings] =
		useState<ClaudeSettings | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [showAddMcpForm, setShowAddMcpForm] = useState(false);
	const [mcpForm, setMcpForm] = useState<AddMcpFormState>(INITIAL_MCP_FORM);
	const [mcpFormError, setMcpFormError] = useState<string | null>(null);

	// Load settings on mount
	useEffect(() => {
		const loadSettings = async () => {
			try {
				const loaded = await configService.getSettings();
				setSettings(loaded);
				setOriginalSettings(loaded);
			} catch (error) {
				new Notice("Failed to load Claude settings");
				console.error(error);
			} finally {
				setIsLoading(false);
			}
		};

		loadSettings();

		// Subscribe to external changes
		const unsubscribe = configService.subscribe((newSettings) => {
			setSettings(newSettings);
			setOriginalSettings(newSettings);
		});

		return unsubscribe;
	}, [configService]);

	// Track dirty state
	useEffect(() => {
		if (!settings || !originalSettings) {
			onDirtyChange(false);
			return;
		}

		const isDirty =
			JSON.stringify(settings) !== JSON.stringify(originalSettings);
		onDirtyChange(isDirty);
	}, [settings, originalSettings, onDirtyChange]);

	const handleSave = useCallback(async () => {
		if (!settings) return;

		setIsSaving(true);
		try {
			await configService.updateSettings(settings);
			setOriginalSettings(settings);
			new Notice("Settings saved");
		} catch (error) {
			new Notice("Failed to save settings");
			console.error(error);
		} finally {
			setIsSaving(false);
		}
	}, [settings, configService]);

	const handleReset = useCallback(() => {
		setSettings(DEFAULT_CLAUDE_SETTINGS);
	}, []);

	const updateSetting = useCallback(
		<K extends keyof ClaudeSettings>(key: K, value: ClaudeSettings[K]) => {
			setSettings((prev) => (prev ? { ...prev, [key]: value } : null));
		},
		[],
	);

	const removeMcpServer = useCallback((name: string) => {
		setSettings((prev) => {
			if (!prev) return null;
			return {
				...prev,
				mcpServers: prev.mcpServers.filter((s) => s.name !== name),
			};
		});
	}, []);

	const handleAddMcpServer = useCallback(async () => {
		// Validate form
		const name = mcpForm.name.trim();
		const command = mcpForm.command.trim();

		if (!name) {
			setMcpFormError("Server name is required");
			return;
		}

		if (!command) {
			setMcpFormError("Command is required");
			return;
		}

		// Check for duplicate name
		if (settings?.mcpServers.some((s) => s.name === name)) {
			setMcpFormError("A server with this name already exists");
			return;
		}

		// Parse args (split by spaces, respecting quotes)
		const argsString = mcpForm.args.trim();
		let args: string[] | undefined;
		if (argsString) {
			// Simple split by whitespace; users can separate args with spaces
			args = argsString.split(/\s+/).filter(Boolean);
		}

		// Add server via configService
		try {
			await configService.addMcpServer({
				name,
				command,
				args,
				enabled: true,
			});

			// Reset form and close
			setMcpForm(INITIAL_MCP_FORM);
			setMcpFormError(null);
			setShowAddMcpForm(false);
		} catch (error) {
			setMcpFormError("Failed to add MCP server");
			console.error(error);
		}
	}, [mcpForm, settings, configService]);

	const handleCancelAddMcp = useCallback(() => {
		setMcpForm(INITIAL_MCP_FORM);
		setMcpFormError(null);
		setShowAddMcpForm(false);
	}, []);

	const updateMcpForm = useCallback(
		<K extends keyof AddMcpFormState>(
			key: K,
			value: AddMcpFormState[K],
		) => {
			setMcpForm((prev) => ({ ...prev, [key]: value }));
			setMcpFormError(null); // Clear error when user types
		},
		[],
	);

	if (isLoading) {
		return (
			<div className="settings-panel settings-loading">
				Loading settings...
			</div>
		);
	}

	if (!settings) {
		return (
			<div className="settings-panel settings-loading">
				Failed to load settings
			</div>
		);
	}

	const isDirty =
		JSON.stringify(settings) !== JSON.stringify(originalSettings);

	return (
		<div className="settings-panel">
			<div className="settings-content">
				{/* Model Selection */}
				<div className="settings-section">
					<h3 className="settings-section-title">Model</h3>
					<div className="settings-model-options">
						{MODEL_OPTIONS.map((option) => (
							<label
								key={option.id}
								className={`settings-model-option ${settings.model === option.id ? "selected" : ""}`}
							>
								<input
									type="radio"
									name="model"
									value={option.id}
									checked={settings.model === option.id}
									onChange={() =>
										updateSetting("model", option.id)
									}
								/>
								<span className="settings-model-option-name">
									{option.label}
								</span>
								<span className="settings-model-option-description">
									{option.description}
								</span>
							</label>
						))}
					</div>
				</div>

				{/* Permissions */}
				<div className="settings-section">
					<h3 className="settings-section-title">Permissions</h3>
					<div className="settings-toggle-row">
						<label>
							Auto-approve file operations
							<div className="settings-row-description">
								Automatically allow Read, Write, and
								file-related tools
							</div>
						</label>
						<input
							type="checkbox"
							className="settings-toggle"
							checked={
								settings.permissions?.autoApproveFileOps ??
								false
							}
							onChange={(e) =>
								updateSetting("permissions", {
									...settings.permissions,
									autoApproveFileOps: e.target.checked,
								})
							}
						/>
					</div>
					<div className="settings-toggle-row">
						<label>
							Auto-approve terminal commands
							<div className="settings-row-description">
								Automatically allow Bash and terminal execution
							</div>
						</label>
						<input
							type="checkbox"
							className="settings-toggle"
							checked={
								settings.permissions?.autoApproveTerminal ??
								false
							}
							onChange={(e) =>
								updateSetting("permissions", {
									...settings.permissions,
									autoApproveTerminal: e.target.checked,
								})
							}
						/>
					</div>
				</div>

				{/* Custom System Prompt */}
				<div className="settings-section">
					<h3 className="settings-section-title">
						Custom System Prompt
					</h3>
					<div className="settings-row">
						<textarea
							className="settings-textarea"
							value={settings.customSystemPrompt ?? ""}
							onChange={(e) =>
								updateSetting(
									"customSystemPrompt",
									e.target.value,
								)
							}
							placeholder="Add custom instructions for Claude..."
						/>
					</div>
				</div>

				{/* MCP Servers */}
				<div className="settings-section">
					<h3 className="settings-section-title">MCP Servers</h3>
					<div className="settings-mcp-list">
						{settings.mcpServers.map((server) => (
							<div
								key={server.name}
								className="settings-mcp-item"
							>
								<div className="settings-mcp-item-info">
									<div className="settings-mcp-item-name">
										{server.name}
									</div>
									<div className="settings-mcp-item-command">
										{server.command}
									</div>
								</div>
								<div className="settings-mcp-item-actions">
									<button
										className="clickable-icon"
										onClick={() =>
											removeMcpServer(server.name)
										}
										title="Remove server"
										ref={(el) => {
											if (el) setIcon(el, "trash-2");
										}}
									/>
								</div>
							</div>
						))}
						{showAddMcpForm ? (
							<div className="settings-mcp-add-form">
								<div className="settings-mcp-form-row">
									<label htmlFor="mcp-name">Name</label>
									<input
										id="mcp-name"
										type="text"
										className="settings-input"
										placeholder="e.g., filesystem"
										value={mcpForm.name}
										onChange={(e) =>
											updateMcpForm(
												"name",
												e.target.value,
											)
										}
										autoFocus
									/>
								</div>
								<div className="settings-mcp-form-row">
									<label htmlFor="mcp-command">Command</label>
									<input
										id="mcp-command"
										type="text"
										className="settings-input"
										placeholder="e.g., npx -y @modelcontextprotocol/server-filesystem"
										value={mcpForm.command}
										onChange={(e) =>
											updateMcpForm(
												"command",
												e.target.value,
											)
										}
									/>
								</div>
								<div className="settings-mcp-form-row">
									<label htmlFor="mcp-args">
										Arguments (space-separated)
									</label>
									<input
										id="mcp-args"
										type="text"
										className="settings-input"
										placeholder="e.g., /path/to/allowed/dir"
										value={mcpForm.args}
										onChange={(e) =>
											updateMcpForm(
												"args",
												e.target.value,
											)
										}
									/>
								</div>
								{mcpFormError && (
									<div className="settings-mcp-form-error">
										{mcpFormError}
									</div>
								)}
								<div className="settings-mcp-form-actions">
									<button
										className="settings-mcp-form-cancel"
										onClick={handleCancelAddMcp}
									>
										Cancel
									</button>
									<button
										className="settings-mcp-form-submit"
										onClick={handleAddMcpServer}
									>
										Add Server
									</button>
								</div>
							</div>
						) : (
							<button
								className="settings-add-button"
								onClick={() => setShowAddMcpForm(true)}
							>
								<span
									ref={(el) => {
										if (el) setIcon(el, "plus");
									}}
								/>
								Add MCP Server
							</button>
						)}
					</div>
				</div>

				{/* Display Options */}
				<div className="settings-section">
					<h3 className="settings-section-title">Display</h3>
					<div className="settings-toggle-row">
						<label>
							Show thinking
							<div className="settings-row-description">
								Display Claude's reasoning process in responses
							</div>
						</label>
						<input
							type="checkbox"
							className="settings-toggle"
							checked={settings.showThinking ?? true}
							onChange={(e) =>
								updateSetting("showThinking", e.target.checked)
							}
						/>
					</div>
				</div>
			</div>
			{/* Footer - outside scrollable area */}
			<div className="settings-footer">
				<button className="settings-reset-button" onClick={handleReset}>
					Reset to Defaults
				</button>
				<button
					className="settings-save-button"
					onClick={handleSave}
					disabled={!isDirty || isSaving}
				>
					{isSaving ? "Saving..." : "Save Changes"}
				</button>
			</div>
		</div>
	);
};
