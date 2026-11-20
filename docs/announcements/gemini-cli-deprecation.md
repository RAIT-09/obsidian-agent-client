# Gemini CLI Preset Removal & Migration

::: warning Preset removal planned for 0.14.0
The Gemini CLI preset will be removed in **Agent Client 0.14.0**. Saved settings and API keys in Obsidian's Keychain will be kept, but Gemini CLI will no longer be available as a preset.

Use the new [Antigravity CLI preset](/agent-setup/antigravity-cli) for Google account login. To keep using Gemini CLI itself, configure a [custom agent](/agent-setup/custom-agents). No automatic conversion or credential transfer is planned.
:::

## What's changing

Google announced that Gemini CLI would **stop serving requests for account-login tiers on June 18, 2026**, as part of the transition to **Antigravity CLI** announced at Google I/O 2026. Antigravity CLI now supports ACP directly and is available as an Agent Client preset.

Account login (signing in with your Google account) is what stops — but Google also points to a way to keep using Gemini CLI:

> "Gemini CLI will remain accessible via paid Gemini and Gemini Enterprise Agent Platform API keys."
> — [Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

Note that Google's wording specifies a **paid** API key. The blog does not state whether a **free-tier** API key will keep working with Gemini CLI after the cutoff, so free-tier continuation is **not guaranteed**. This plugin drives Gemini CLI with an API key, so a paid API key is the dependable path forward.

## Who is affected

| Tier / access | Still usable after June 18, 2026? |
| --- | --- |
| Free tier (account login) | ❌ No — account login stops |
| Google AI Pro (account login) | ❌ No — account login stops |
| Google AI Ultra (account login) | ❌ No — account login stops |
| **Gemini CLI via a paid API key** | ✅ Yes — keeps working |

::: tip Note
Being on a paid plan (Pro or Ultra) does **not** exempt you — the cutoff is about the *account-login* method, not whether you pay. The reliable way to keep going is a **paid API key** (see below).
:::

## Migration options

### Option A — Switch to Antigravity CLI (recommended)

Follow [Antigravity CLI Setup](/agent-setup/antigravity-cli) to install `agy`, sign in, and select the preset. It uses `agy acp` and does not require a community bridge.

### Option B — Keep using Gemini CLI with a paid API key

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and enable billing to move it to a [paid tier](https://ai.google.dev/gemini-api/docs/billing). This is the access Google explicitly says keeps working.
2. Configure the key in this plugin by following the [Gemini CLI Setup](/agent-setup/gemini-cli) page (Option B: API key, or Option C: Vertex AI).

The Gemini CLI preset remains available until 0.14.0. Before upgrading to that version, copy your command, arguments, and other required settings into a [custom agent](/agent-setup/custom-agents). For a standard installation, use command `gemini` and argument `--experimental-acp`. Choose a separate id such as `gemini-custom` while the preset still exists.

Retaining a Keychain secret does not automatically link it to a custom agent. Configure authentication on the Gemini CLI side; custom-agent environment variables are stored in plain text.

::: tip About the free tier
The Gemini API has a free tier, and as of writing models such as `gemini-2.5-pro` and `gemini-3.5-flash` show as free of charge on the [pricing page](https://ai.google.dev/gemini-api/docs/pricing). **However, Google's announcement only guarantees access via a *paid* API key** — it does not say a free-tier key will keep working with Gemini CLI after June 18, 2026. A free key *may* work, but it is not guaranteed; if you need reliability, use a paid key. Rate limits for any tier can be checked in the [AI Studio rate-limit dashboard](https://aistudio.google.com/rate-limit).
:::

::: tip Privacy note
A paid API key also helps with privacy. Agent Client can send your **note contents** to the model as context, and on **paid** tiers Google does not use that data to improve its products: *"When you use Paid Services, Google doesn't use your prompts ... or responses to improve our products."* (If you ever fall back to a free-tier key, note that free/unpaid usage **can** be used for product improvement and human review.) Source: [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms).
:::

### Option C — Switch to another ACP agent

This plugin works with any agent that speaks the Agent Client Protocol (ACP). If you'd rather move off Gemini entirely:

- [Claude Code](/agent-setup/claude-code)
- [Codex](/agent-setup/codex)

## What about Antigravity CLI?

Antigravity CLI gained native ACP support with `agy acp` in **CLI 1.5.0, released November 4, 2026**. It is now a preset agent in this plugin. See [Antigravity CLI Setup](/agent-setup/antigravity-cli), Google's [ACP guide](https://antigravity.google/docs/cli/acp/), and the [CLI changelog](https://antigravity.google/docs/changelog?tab=cli).

## Questions?

If anything is unclear or you run into trouble migrating, join the discussion on [GitHub](https://github.com/RAIT-09/obsidian-agent-client/discussions/300).

## Sources

- [An important update: Transitioning Gemini CLI to Antigravity CLI — Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- [Google I/O 2026 developer highlights — Google blog](https://blog.google/intl/ja-jp/company-news/technology/google-io-2026-developer-highlights/)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
