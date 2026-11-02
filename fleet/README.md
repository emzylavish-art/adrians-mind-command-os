# Telegram fleet scaffold

This folder is the non-secret kit for five Telegram bots. Clone the repo, follow `RECOVERY.md`, and the same fleet can be rebuilt on Linux, macOS, or Windows without an assistant.

The blueprint is `BLUEPRINT.md`. The shared loop is `harness/main.py`. Each bot folder is a thin entrypoint plus its own persona, state, memory, and journal.

No token, API hash, phone number, or session file belongs in git. Live values stay in `fleet/.env.fleet` and `fleet/<bot>/.env`, which are gitignored. The tracked files are examples with empty values.

## Bots

Mint order is fixed.

| Folder | Display name | Loop |
| --- | --- | --- |
| `mind_observer_bot` | Mind Observer | Polls about every 20 seconds. Start this one first. |
| `mind_spec_bot` | Mind Spec | Same shared loop. Writes only the specification the task already states. |
| `mind_log_bot` | Mind Log | Same shared loop. The deliverable is the one-line achievement. |
| `mind_push_bot` | Mind Push | Polls every 30 minutes (`1800` seconds). |
| `mind_notion_bot` | Mind Notion | Same shared loop, aimed at the four Notion structures. |

`POLL_INTERVAL_SECONDS` in a bot `.env` overrides the default for that process.

## What the harness does

1. Writes `STATE.json` before it interprets a task or calls a model.
2. Polls the Notion Task Queue for the oldest OPEN task whose Assignee is this bot id.
3. Marks that task CLAIMED, writes state again, and appends one journal line.
4. Checks that the OpenAI key works and that a credit or prepaid balance is greater than zero. If that check fails, it does not call the model.
5. Calls the model once with `SOUL.md` and the task text. The model is told to execute only that task.
6. Appends one line to `JOURNAL.md` and to the Notion Achievement Log, then updates Fleet Status and `STATE.json`.

Log lines are UTC and look like this:

```text
YYYY-MM-DD HH:MM | mind_observer_bot | DONE | one line of detail
```

Two consecutive failures, with no successful task between them, set `halted` to true, stop the process, and send that same one-line text to `HUMAN_TELEGRAM_CHAT_ID`. An empty queue does not clear the failure count. A completed task does. After a halt, the process stays stopped until you start it again with `FLEET_RESUME=1`.

The human is the final authority. The harness does not invent tasks, does not give the model a Notion write tool, and does not put secrets into Notion or Telegram. Task titles and model text are redacted for bot-token shapes and for the secret values loaded from the environment before they are logged.

## Layout

```text
fleet/
  BLUEPRINT.md
  RECOVERY.md
  requirements.txt
  .env.fleet.example
  harness/main.py
  schemas/state.schema.json
  scripts/create_session.py
  scripts/mint_bots.py
  scripts/connect_existing_bot.py
  scripts/show_chat_id.py
  mind_observer_bot/ ... mind_notion_bot/
```

`scripts/show_chat_id.py` prints numeric chat ids from `getUpdates` after you message the bot. It does not print the token or the message text.

## Run one bot

From the repository root, after `RECOVERY.md` Phase 4 and Phase 5 setup:

```bash
python fleet/mind_observer_bot/main.py
```

Run one process per bot. A second process for the same bot exits `BLOCKED` while the first pid is alive.

## Hard stops

- Do not push this fleet, or any secret it uses, to `main`.
- Do not touch Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.
- Stop when a command prints `BLOCKED`.
