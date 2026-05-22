# Session Manager

A dedicated sidebar view that lists all open chat sessions with live status, so you can keep track of multiple conversations at a glance.

<p align="center">
  <img src="/images/session-manager-view.webp" alt="Session Manager view in the left sidebar" width="400" />
</p>

## Overview

The Session Manager shows every chat view (sidebar and floating) currently open, with:

- **Session title** — derived from the first message, or the saved title if you renamed it
- **Agent name** — which agent the session is using
- **Status icon** — live indicator of what the session is doing right now
- **Focus highlight** — the currently focused chat view is marked as active

::: tip
This is especially useful when you have many chat views open and want to see which one is generating, awaiting permission, or idle.
:::

## Opening the Session Manager

You can open the Session Manager in several ways:

- **Chat header menu**: Click the **⋮** (more) menu in any chat view's header and select **"Open session manager"**
- **Command palette**: Open `Cmd/Ctrl + P` and search for **"Open session manager"**

The view opens in the left sidebar by default. You can drag it to a different location like any other Obsidian view.

::: tip
Assign a keyboard shortcut to **"Open session manager"** in **Settings → Hotkeys** for quick access.
:::

## Status Icons

Each session entry shows an icon reflecting its current state:

| Icon | Status | Meaning |
|------|--------|---------|
| <img src="/images/status-ready.webp" alt="Ready" width="32" /> | **Ready** | The session is connected and idle, waiting for your next message |
| <img src="/images/status-busy.webp" alt="Busy" width="32" /> | **Busy** | The agent is processing or generating a response |
| <img src="/images/status-permission.webp" alt="Permission" width="32" /> | **Permission** | The agent is waiting for you to approve or reject an action |
| <img src="/images/status-error.webp" alt="Error" width="32" /> | **Error** | The session encountered an error |

## Actions

### Switch to a Session

Click any session entry to focus that chat view. If the view is in the sidebar, Obsidian reveals it. If it is a floating window, it is brought to the front.

### Session Menu

Click the **⋮** (more) button on the right of any session entry, or right-click the entry, to open the action menu:

<p align="center">
  <img src="/images/session-manager-context-menu.webp" alt="Session entry context menu showing Rename and Close" width="400" />
</p>

| Action | Description |
|--------|-------------|
| **Rename** | Edit the session title. The new title is shown both in the Session Manager and on the chat view's tab |
| **Close** | Close the chat view (the underlying session remains in History) |

::: tip
Renaming is also available from the chat header (**⋮** menu → **Rename session**) and from [Session History](/usage/session-history).
:::

## Empty State

If no chat views are open, the Session Manager shows **"No active sessions"**. Open a chat view (ribbon icon or the **"Open chat view"** command) to populate the list.

## See Also

- [Multi-Session Chat](/usage/multi-session) for opening multiple chat views and broadcasting prompts
- [Session History](/usage/session-history) for resuming or forking past sessions
- [Floating Chat](/usage/floating-chat) for floating chat windows
