# GitHub Copilot Instructions (obsidian-agent-client)

## Big picture
- Obsidian **desktop** plugin (React 19 + TypeScript) that chats with external coding agents via **Agent Client Protocol (ACP)**.
- Uses a **React Hooks Architecture**: hooks own state/logic, components render, adapters integrate external systems, domain is pure types.

## Key directories / “where to change things”
- UI composition + adapter instantiation: `src/components/chat/ChatView.tsx` (creates adapters via `useMemo`, composes hooks).
- Session lifecycle + agent switching: `src/hooks/useAgentSession.ts`.
- Message state + streaming updates: `src/hooks/useChat.ts`.
- ACP process + JSON-RPC wiring: `src/adapters/acp/acp.adapter.ts`.
- Pure message prep/sending (mentions, auto-mention, WSL path conversion): `src/shared/message-service.ts`.
- Domain contracts only (no deps): `src/domain/models/*`, `src/domain/ports/*`.

## Architectural rules (project-specific)
- Keep `src/domain/**` dependency-free: **no** `obsidian` imports, **no** `@agentclientprotocol/sdk` imports.
- Add new behavior as **hooks** under `src/hooks/` and compose them in `ChatView.tsx` (avoid introducing ViewModel/UseCase classes).
- Put non-React business logic in `src/shared/` as **pure functions** (see `message-service.ts`).
- Adapters implement ports and isolate protocol/platform churn (ACP changes should mostly stay in `src/adapters/acp/`).

## SessionUpdate / tool-call update flow (critical)
- Use the unified pipeline: `AcpAdapter.onSessionUpdate(...)` → `useChat.handleSessionUpdate(...)`.
- Tool calls must be updated via `useChat.upsertToolCall(...)` using **functional** `setMessages((prev) => ...)` to avoid race conditions from streaming `tool_call_update` events.
- When merging tool-call content, preserve existing values when updates are `undefined` and treat diffs as replace-all (see `mergeToolCallContent` in `useChat.ts`).

## Obsidian & platform constraints
- Desktop-only: `ChatView` throws when `!Platform.isDesktopApp`.
- Use Obsidian `Platform.isWin/isMacOS/isLinux` helpers (avoid `process.platform`).
- No `innerHTML/outerHTML`; use Obsidian element helpers (`createEl/createDiv/createSpan`).
- Don't detach leaves in `onunload`.
- Keep styling in `styles.css` (avoid JS style manipulation).

## Developer workflows
- Dev watch build: `npm run dev` (esbuild watch; outputs `main.js`).
- Production build: `npm run build` (runs `tsc -noEmit -skipLibCheck` then esbuild production).
- Formatting: `npm run format` / `npm run format:check` (Prettier).
- Linting: `npm run lint` / `npm run lint:fix`.
- Docs site: `npm run docs:dev`, `npm run docs:build`, `npm run docs:preview`.

## Naming conventions used throughout
- Ports: `*.port.ts`
- Adapters: `*.adapter.ts`
- Hooks: `use*.ts`
- Components: `PascalCase.tsx`
- Utilities/models: `kebab-case.ts`
