# Platform capability research

Date: 2026-04-01 (session date in the repository clock is the current sandbox date).

This file records what was actually inspected. It is not a recovered source dump of any product.

## Evidence classes

- OBSERVED: seen in an owner screenshot or in this app's own UI.
- DOCUMENTED: taken from a vendor's public description, not from a live signed-in session in this sandbox.
- VERIFIED: a command in this repository produced the result.
- BLOCKED: the inspection could not be run.
- UNKNOWN: not established.

## REA environment

Command: `npx -y rea-agents@6.8.0 doctor --format json`

Result: exit 1. `healthy` false. `environment_healthy` false. CLI package 6.8.0. Node 22.23.3, which doctor rejects because it wants 22.23.4 or newer on the Node 22 line. Host debian 12 is healthy. Hopper, Ghidra, IDA, JADX, and Kuna are not configured. Grok Build MCP registration is missing (`/root/.grok/config.toml`). `ps` is not on PATH.

No public website was attached to a Chrome debugging port. `rea inspect-web-page`, `analyze-web-bundle`, and `observe-web-session` were not run. Those targets are BLOCKED until a local browser is listening on 127.0.0.1:9222 and the owner is signed in. Passwords, cookies, and tokens were not requested.

Native engines were not installed. They were not required to build the local worker, and commercial engines were not purchased.

## Targets

| Target | Status | What was inspected | What was not |
|---|---|---|---|
| ChatGPT | PARTIAL / OBSERVED | Owner screenshots of the phone UI: left navigation with Library, Projects, Plugins, Scheduled, Explore, pinned items, and recents. A plugins list (Gmail, Drive, Health, GitHub, iCloud Mail) and a scheduled-task list (news, email monitor, reading, price, concerts, weekend). | No live page, no bundle, no network log, no authenticated workflow. |
| Claude | PARTIAL / OBSERVED | Owner screenshot of a side navigation: Chats, Projects, Code, Artifacts, recents, New chat. | No live page or bundle. |
| Grok | DOCUMENTED / PARTIAL | This product already sends chat only when the owner presses Send, model grok-4.5, max 500 tokens. A live reply was not spent in this change. | The public grok.com app was not inspected with REA. |
| Gemini | BLOCKED | Named as a provider that cannot be selected until a key exists. | No page, no Workspace OAuth, no bundle. |
| Manus | PARTIAL / OBSERVED | Owner screenshots of a phone shell: Automations, Projects, a list of named bots with timestamps, Settings rows for Knowledge, Mail, Data controls, Cloud Browser, Skills, Connectors, Integrations, Email, Phone, My computer, Wallet. | No live browser session, no task replay, no private Manus source. |
| Perplexity | BLOCKED | Search-and-citation behavior is the intended pattern for this app's research screen. | No page inspection. |
| OpenRouter | BLOCKED | Treated as an unconfigured provider. No catalog was fetched. | No API call. |
| Zapia | PARTIAL / OBSERVED | Owner screenshot of a side list: Scheduled, Radar, Connectors, pinned work, conversations, New Chat. | Not implemented. Still deferred. |

Personal names, email addresses, and conversation titles visible in the screenshots were not copied into the product.

## What the screenshots imply for this app

OBSERVED navigation pattern, shared by the screenshots:

- A persistent side list, not a single chat box.
- Projects and scheduled work as first-class entries.
- Connectors or plugins as their own surface.
- Recent work under the navigation.
- A clear primary action (new chat or new task).

INFERRED, not proven from source: those products split agent work from the chat transcript and show status over time. This repository now has a Runs surface fed by worker events. That is an implementation choice, not a copy of anyone's private code.

## What Adrian's Mind already had before this change

Verified in earlier commits: memory off by default, ask mode, delete approval, emergency stop, stop-one-reply abort of the Grok stream, provider refusal for GPT/Claude/Gemini/OpenRouter, research refusal without a search key, bounded three-tool planner with a fake model, in-memory database when `DATABASE_URL` is unset.

## What this change added

A local worker, agent templates, run events, schedule queueing, connection records without secrets, mailbox records that stay disconnected, and a headless page driver for an explicit URL. Details are in the other docs in this folder.
