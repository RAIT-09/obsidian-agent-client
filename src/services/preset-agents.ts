/**
 * Static registry of preset (built-in) agents.
 *
 * Each entry is code-shipped metadata: identity, spawn defaults, legacy
 * data.json migration keys, API-key wiring, install hints, and settings-UI
 * copy. User overrides live in `settings.presetAgents[presetId]` and are
 * produced by `normalizePresetAgents` (settings-normalizer.ts).
 *
 * Adding a preset agent = adding one entry here + a docs page
 * (see AGENTS.md "Add Preset Agent").
 */

/** Legacy plaintext-key → secret-storage migration wiring (original presets only). */
export interface PresetAgentApiKeyLegacy {
	/** Preferred secret id to create on migration. */
	defaultSecretId: string;
	/** Fallback secret id when the preferred one is taken by another value. */
	fallbackSecretId: string;
	/**
	 * Agent name used inside the migration Notices. Kept explicit because it
	 * historically differs from defaultDisplayName ("Claude" vs "Claude Code",
	 * "Gemini" vs "Gemini CLI") and deriving it would change user-facing text.
	 */
	noticeLabel: string;
}

/** API-key injection wiring. Absent = the agent has no API key row (login-only). */
export interface PresetAgentApiKey {
	/** Environment variable the resolved secret is injected as at spawn time. */
	envVarName: string;
	/** Description shown under the "API key" setting. */
	settingDesc: string;
	/** Present only for presets that ever stored a plaintext key in data.json. */
	legacy?: PresetAgentApiKeyLegacy;
}

/** Copyable install hint(s) shown under the Path setting. */
export interface PresetAgentInstallHint {
	default: string;
	/** Shown instead of `default` on native Windows (WSL mode keeps `default`). */
	nativeWindows?: string;
}

/** Per-preset settings-screen copy that deviates from the shared template. */
export interface PresetAgentSettingsCopy {
	/** Description of the Path setting. */
	pathDesc: string;
	/** Appended verbatim to the shared Arguments description. */
	argsDescSuffix?: string;
	/** Inserted between the shared env intro and the derived-API-key sentence. */
	envDescExtra?: string;
	/** Placeholder for the Environment variables textarea. */
	envPlaceholder?: string;
}

/**
 * Static, code-shipped definition of a preset agent. Users never edit this;
 * their overrides live in settings.presetAgents[presetId].
 */
export interface PresetAgentDefinition {
	/**
	 * Stable id — the agentId AND the presetAgents record key. The stored
	 * entry's inner `id` is force-synced to this (never read from data.json).
	 */
	presetId: string;
	defaultDisplayName: string;
	defaultCommand: string;
	/**
	 * Default args. Normalization falls back to these whenever the stored
	 * args sanitize to empty (historic Gemini behavior, generalized — for
	 * presets with non-empty defaults the args are effectively unclearable).
	 */
	defaultArgs: string[];
	/** Legacy data.json per-agent sub-object key (original four presets only). */
	legacySettingsKey?: "claude" | "codex" | "gemini" | "mistralVibe";
	/** Legacy data.json top-level command-path key (claude / gemini only). */
	legacyCommandPathKey?: string;
	apiKey?: PresetAgentApiKey;
	/**
	 * Custom-agent id this preset absorbs on first load (one-shot migration).
	 * Set ONLY for presets whose id our docs historically advised as a
	 * custom-agent recipe — those customs are docs-followers by near
	 * certainty, so adopting their settings preserves what the id meant
	 * (fence pins, saved sessions, default agent). Deliberately NOT a
	 * generic custom-id==presetId rule: customs colliding with the original
	 * four preset ids are dead weight under preset-first resolution, and
	 * absorbing them would overwrite live preset settings.
	 */
	absorbsCustomAgentId?: string;
	installHint: PresetAgentInstallHint;
	settingsCopy: PresetAgentSettingsCopy;
	/** Page name under docs/agent-setup/ (for setup-guide references). */
	docsPage: string;
}

export const PRESET_AGENTS: readonly PresetAgentDefinition[] = [
	{
		presetId: "claude-code-acp",
		defaultDisplayName: "Claude Code",
		defaultCommand: "claude-agent-acp",
		defaultArgs: [],
		legacySettingsKey: "claude",
		legacyCommandPathKey: "claudeCodeAcpCommandPath",
		apiKey: {
			envVarName: "ANTHROPIC_API_KEY",
			settingDesc:
				"Anthropic API key. Required if not logging in with an Anthropic account. Select from Obsidian's Keychain or create a new secret.",
			legacy: {
				defaultSecretId: "claude-api-key",
				fallbackSecretId: "agent-client-claude-api-key",
				noticeLabel: "Claude",
			},
		},
		installHint: {
			default:
				"npm install -g @agentclientprotocol/claude-agent-acp@latest",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to claude-agent-acp. Use just "claude-agent-acp" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "claude-code",
	},
	{
		presetId: "codex-acp",
		defaultDisplayName: "Codex",
		defaultCommand: "codex-acp",
		defaultArgs: [],
		legacySettingsKey: "codex",
		apiKey: {
			envVarName: "OPENAI_API_KEY",
			settingDesc:
				"OpenAI API key. Required if not logging in with an OpenAI account. Select from Obsidian's Keychain or create a new secret.",
			legacy: {
				defaultSecretId: "openai-api-key",
				fallbackSecretId: "agent-client-openai-api-key",
				noticeLabel: "Codex",
			},
		},
		installHint: {
			default: "npm install -g @agentclientprotocol/codex-acp@latest",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to codex-acp. Use just "codex-acp" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "codex",
	},
	{
		presetId: "gemini-cli",
		defaultDisplayName: "Gemini CLI",
		defaultCommand: "gemini",
		defaultArgs: ["--experimental-acp"],
		legacySettingsKey: "gemini",
		legacyCommandPathKey: "geminiCommandPath",
		apiKey: {
			envVarName: "GEMINI_API_KEY",
			settingDesc:
				"Gemini API key. Required if not logging in with a Google account. Select from Obsidian's Keychain or create a new secret.",
			legacy: {
				defaultSecretId: "gemini-api-key",
				fallbackSecretId: "agent-client-gemini-api-key",
				noticeLabel: "Gemini",
			},
		},
		installHint: {
			default: "npm install -g @google/gemini-cli@latest",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to the Gemini CLI. Use just "gemini" to let the login shell resolve it, or enter an absolute path for a specific version.',
			argsDescSuffix:
				'(Currently, the Gemini CLI requires the "--experimental-acp" option.)',
			envDescExtra: "Required to authenticate with Vertex AI.",
			envPlaceholder: "GOOGLE_CLOUD_PROJECT=...",
		},
		docsPage: "gemini-cli",
	},
	{
		presetId: "mistral-vibe",
		defaultDisplayName: "Mistral Vibe",
		defaultCommand: "vibe-acp",
		defaultArgs: [],
		legacySettingsKey: "mistralVibe",
		apiKey: {
			envVarName: "MISTRAL_API_KEY",
			settingDesc:
				"Mistral API key. Required if not logging in with a Mistral account. Select from Obsidian's Keychain or create a new secret.",
			legacy: {
				defaultSecretId: "mistral-api-key",
				fallbackSecretId: "agent-client-mistral-api-key",
				noticeLabel: "Mistral Vibe",
			},
		},
		installHint: {
			default: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
			nativeWindows:
				'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"; uv tool install mistral-vibe',
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to vibe-acp. Use just "vibe-acp" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "mistral-vibe",
	},
	{
		presetId: "opencode",
		defaultDisplayName: "OpenCode",
		defaultCommand: "opencode",
		defaultArgs: ["acp"],
		absorbsCustomAgentId: "opencode",
		installHint: {
			default: "curl -fsSL https://opencode.ai/install | bash",
			nativeWindows: "npm install -g opencode-ai",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to opencode. Use just "opencode" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "opencode",
	},
	{
		presetId: "kiro-cli",
		defaultDisplayName: "Kiro",
		defaultCommand: "kiro-cli",
		defaultArgs: ["acp"],
		absorbsCustomAgentId: "kiro-cli",
		apiKey: {
			envVarName: "KIRO_API_KEY",
			settingDesc:
				"Kiro API key (Kiro Pro and higher tiers). Required only for API-key auth — leave empty when signing in with kiro-cli login. Select from Obsidian's Keychain or create a new secret.",
		},
		installHint: {
			default: "curl -fsSL https://cli.kiro.dev/install | bash",
			nativeWindows: "irm 'https://cli.kiro.dev/install.ps1' | iex",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to kiro-cli. Use just "kiro-cli" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "kiro",
	},
	{
		presetId: "hermes-agent",
		defaultDisplayName: "Hermes Agent",
		defaultCommand: "hermes",
		defaultArgs: ["acp"],
		installHint: {
			default:
				"curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
			nativeWindows:
				"iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to hermes. Use just "hermes" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "hermes",
	},
	{
		presetId: "pi-acp",
		defaultDisplayName: "Pi",
		defaultCommand: "pi-acp",
		defaultArgs: [],
		installHint: {
			default: "npm install -g @earendil-works/pi-coding-agent pi-acp",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to pi-acp. Use just "pi-acp" to let the login shell resolve it, or enter an absolute path.',
		},
		docsPage: "pi",
	},
	{
		presetId: "grok-build",
		defaultDisplayName: "Grok Build",
		defaultCommand: "grok",
		defaultArgs: ["agent", "stdio"],
		apiKey: {
			envVarName: "XAI_API_KEY",
			settingDesc:
				"xAI API key. Required only for API-key auth — leave empty when signing in with grok login. Select from Obsidian's Keychain or create a new secret.",
		},
		installHint: {
			default: "curl -fsSL https://x.ai/cli/install.sh | bash",
			nativeWindows: "irm https://x.ai/cli/install.ps1 | iex",
		},
		settingsCopy: {
			pathDesc:
				'Command name or path to grok. Use just "grok" to let the login shell resolve it, or enter an absolute path.',
			argsDescSuffix:
				'(Currently, Grok Build requires the "agent stdio" options.)',
		},
		docsPage: "grok-build",
	},
];

/**
 * The Gemini preset id, referenced by the time-boxed Gemini CLI deprecation
 * notice (Google retires account login on June 18, 2026). Deliberately a
 * standalone constant instead of a registry field: the notice is temporary
 * and should be deleted together with this constant's references, without
 * leaving a dead field in the permanent registry schema.
 */
export const GEMINI_PRESET_ID = "gemini-cli";
