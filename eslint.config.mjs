import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	{
		ignores: [
			"node_modules/",
			"main.js",
			"dist/",
			"scripts/",
			"docs/",
			"vite.config.ts",
			"vitest.config.ts",
			"coverage/",
			"docs/.vitepress/dist/",
			"docs/.vitepress/cache/",
		],
	},
	...obsidianmd.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: [
						"Obsius",
						"Claude Code",
						"Gemini CLI",
						"Gemini",
						"Codex",
						"Node.js",
						"Cmd/Ctrl+Enter",
						"GitHub",
						"Obsidian",
						"Google",
						"Anthropic",
						"OpenAI",
						"Vertex AI",
						"macOS",
						"Linux",
						"Windows",
						"Ubuntu",
						"Debian",
						"Base64",
					],
					acronyms: ["AI", "API", "URL", "JSON", "WSL", "MCP", "ID"],
					enforceCamelCaseLower: true,
				},
			],
		},
	},
	{
		files: ["test/**/*.ts", "test/**/*.tsx"],
		rules: {
			"@typescript-eslint/unbound-method": "off",
		},
	},
]);
