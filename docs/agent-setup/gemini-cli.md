# Gemini CLI Setup

::: warning Gemini CLI is being discontinued
Google is retiring account login for Gemini CLI (Pro / Ultra / free tiers) on **June 18, 2026**. Google states Gemini CLI stays accessible via a **paid** Gemini API key. See **[Gemini CLI Discontinuation & Migration](/announcements/gemini-cli-deprecation)**.
:::

Gemini CLI is Google's AI assistant. You can authenticate using your **Google account**, an **API key**, or **Vertex AI**.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install Gemini CLI:

```bash
npm install -g @google/gemini-cli
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which gemini
# Example output: /usr/local/bin/gemini
```

```cmd [Windows]
where.exe gemini
# Example output: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
```

:::

3. Open **Settings → Agent Client**. The default command (`gemini`) works in many cases. If the agent is not found automatically, set the **Gemini CLI path** to the path found above, or click **Auto-detect**.

4. Ensure **Arguments** contains `--experimental-acp` (this is set by default).

## Authentication

Choose one of the following methods:

### Option A: Google Account Login (OAuth)

If you have a Google account and prefer not to use an API key, you can log in directly.

::: warning
Account login is being discontinued for Pro / Ultra / free tiers on June 18, 2026. See [Gemini CLI Discontinuation & Migration](/announcements/gemini-cli-deprecation).
:::

1. Run Gemini CLI in your terminal and choose "Login with Google":

```bash
gemini
```

2. Follow the browser authentication flow.

3. In **Settings → Agent Client**, leave the **API key field empty**.

::: tip
If you have a Gemini Code Assist License from your organization, add `GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID` in the **Environment variables** field.
:::

### Option B: Gemini API Key

If you prefer to use an API key for authentication:

1. Get your API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Enter the API key in **Settings → Agent Client → Gemini CLI → API key**

::: tip If the key isn't picked up
If authentication still fails, set the key on the Gemini CLI side instead: run `gemini` in your terminal, type `/auth`, choose **Use Gemini API Key**, and paste your key (it's stored in your system keychain). Then leave the **API key field empty** in Agent Client.
:::

### Option C: Vertex AI

If you are using Vertex AI for enterprise workloads:

1. In **Settings → Agent Client → Gemini CLI → Environment variables**, add:

```
GOOGLE_API_KEY=YOUR_API_KEY
GOOGLE_GENAI_USE_VERTEXAI=true
```

2. Leave the **API key field empty** (use Environment variables instead).

::: tip If it isn't picked up
If authentication still fails, configure Vertex AI on the Gemini CLI side instead: run `gemini` in your terminal, type `/auth`, and choose **Vertex AI**.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Gemini CLI from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
