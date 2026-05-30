# Gemini CLI Discontinuation & Migration

::: warning Gemini CLI is being discontinued
Google is retiring **account login for Gemini CLI (Pro / Ultra / free tiers) on June 18, 2026**. After that date, signing in with your Google account will stop working in Gemini CLI.

According to Google, **Gemini CLI stays accessible via a paid Gemini API key**, so the reliable way to keep using Gemini in this plugin is a paid API key.
:::

## What's changing

On **June 18, 2026**, Gemini CLI will **stop serving requests** for account-login tiers. This is part of Google's transition from Gemini CLI to the new **Antigravity CLI**, announced at Google I/O 2026.

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

## How to keep using Gemini in this plugin

### Option A — Use a paid Gemini API key (recommended)

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and enable billing to move it to a [paid tier](https://ai.google.dev/gemini-api/docs/billing). This is the access Google explicitly says keeps working.
2. Configure the key in this plugin by following the [Gemini CLI Setup](/agent-setup/gemini-cli) page (Option B: API key, or Option C: Vertex AI).

::: tip About the free tier
The Gemini API has a free tier, and as of writing models such as `gemini-2.5-pro` and `gemini-3.5-flash` show as free of charge on the [pricing page](https://ai.google.dev/gemini-api/docs/pricing). **However, Google's announcement only guarantees access via a *paid* API key** — it does not say a free-tier key will keep working with Gemini CLI after June 18, 2026. A free key *may* work, but it is not guaranteed; if you need reliability, use a paid key. Rate limits for any tier can be checked in the [AI Studio rate-limit dashboard](https://aistudio.google.com/rate-limit).
:::

::: tip Privacy note
A paid API key also helps with privacy. Agent Client can send your **note contents** to the model as context, and on **paid** tiers Google does not use that data to improve its products: *"When you use Paid Services, Google doesn't use your prompts ... or responses to improve our products."* (If you ever fall back to a free-tier key, note that free/unpaid usage **can** be used for product improvement and human review.) Source: [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms).
:::

### Option B — Switch to another ACP agent

This plugin works with any agent that speaks the Agent Client Protocol (ACP). If you'd rather move off Gemini entirely:

- [Claude Code](/agent-setup/claude-code)
- [Codex](/agent-setup/codex)

## What about Antigravity CLI?

Google's replacement, **Antigravity CLI**, does **not currently support ACP** (there is no `--experimental-acp` mode), so this plugin **cannot connect to it as a built-in agent yet**. Antigravity CLI is also not open source.

If Google adds ACP support — or if an adapter built on the **Antigravity SDK** emerges (similar to how `claude-agent-acp` is built on the Claude Agent SDK rather than wrapping the CLI) — built-in support will be reconsidered. For Google's own migration steps, see the [Antigravity CLI migration guide](https://antigravity.google/docs/gcli-migration).

A community ACP bridge, [`agy-acp`](https://github.com/openabdev/openab/tree/main/agy-acp), does exist and can be added as a [custom agent](/agent-setup/custom-agents). It works as a minimal text chat only — streaming, tool calls, and diffs don't come through — so it's an escape hatch rather than a full replacement.

## Questions?

If anything is unclear or you run into trouble migrating, join the discussion on [GitHub](https://github.com/RAIT-09/obsidian-agent-client/discussions/300).

## Sources

- [An important update: Transitioning Gemini CLI to Antigravity CLI — Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- [Google I/O 2026 developer highlights — Google blog](https://blog.google/intl/ja-jp/company-news/technology/google-io-2026-developer-highlights/)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
