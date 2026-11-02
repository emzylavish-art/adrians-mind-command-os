# Rebuild the Telegram fleet from scratch

Use this runbook on Linux, macOS, or Windows. The clone already contains the scaffold. You supply the Telegram account, the Notion workspace, and the OpenAI key. No assistant is required.

Do the phases in order. Each phase ends with an acceptance check. If a command prints `BLOCKED`, stop. Do not invent a bypass.

The human is the final authority. Fixed tasks only.

## Hard rules

- Work on `preview/integration` or a branch cut from it. Do not push or merge this fleet onto `main`.
- Do not touch Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`. This fleet does not use Supabase.
- Never paste a token, API hash, phone number, session string, or OpenAI key into Notion, Telegram, a journal, a commit, or a chat with an assistant.
- Journal lines stay on one line: `YYYY-MM-DD HH:MM | <BOT> | <STATUS> | <detail>` in UTC.
- The harness writes `STATE.json` before it thinks and before it calls a model.
- Two consecutive failures halt that bot and alert `HUMAN_TELEGRAM_CHAT_ID`.
- Stop on `BLOCKED`.

## 0. Tools

Install Git and Python 3.11 or newer. On Windows, the `py -3` launcher is enough.

Check:

```bash
python3 --version
```

Windows PowerShell:

```powershell
py -3 --version
```

Acceptance: the version is 3.11 or newer.

## 1. Clone

```bash
git clone https://github.com/emzylavish-art/adrians-mind-command-os.git
cd adrians-mind-command-os
git checkout preview/integration
```

Acceptance: `fleet/BLUEPRINT.md` and `fleet/harness/main.py` exist. `git status` does not show `main` as the current branch.

## 2. Virtual environment and packages

Linux or macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r fleet/requirements.txt
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r fleet/requirements.txt
```

Acceptance: `python -c "import telethon, dotenv, requests, openai"` prints nothing and exits 0.

## 3. Phase 1 — Telethon session

1. Open <https://my.telegram.org> and sign in with the phone number that will own the bots.
2. Open **API development tools**.
3. Create an application if one does not exist. The title can be `Adrian Fleet`.
4. Copy `api_id` and `api_hash` into a local file only.

From the repository root:

```bash
cp fleet/.env.fleet.example fleet/.env.fleet
```

Windows PowerShell:

```powershell
Copy-Item fleet\.env.fleet.example fleet\.env.fleet
```

Edit `fleet/.env.fleet` so the three names have values and nothing else is added to git:

```text
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_PHONE=
```

`TELEGRAM_PHONE` is the international number, for example `+15551234567` (use your own number). Do not commit this file.

Run the session script. It is two steps in one command: it requests a login code, then asks for that code. Input is hidden. If the account has a cloud password, it asks for that next, also hidden.

```bash
python fleet/scripts/create_session.py
```

Acceptance: the script prints `PHASE 1 ACCEPTANCE` and the file `fleet/fleet_session.session` exists. `git status` does not list it. Do not print, copy, or commit the session file.

## 4. Phase 2 — mint the five bots

The script loads `fleet/fleet_session.session`, opens a private chat with `@BotFather`, and mints in this order:

1. Mind Observer (`mind_observer_bot`)
2. Mind Spec (`mind_spec_bot`)
3. Mind Log (`mind_log_bot`)
4. Mind Push (`mind_push_bot`)
5. Mind Notion (`mind_notion_bot`)

```bash
python fleet/scripts/mint_bots.py
```

Each token is written to `fleet/<bot>/.env` as `TELEGRAM_TOKEN`. The script then calls `getMe` and prints the numeric id, username, and display name. It does not print the token.

If a username is taken or rejected, the script retries **once**. Telegram requires a bot username to end in `bot`, so the retry inserts a 6-character hex suffix before that ending: `mind_observer_a1b2c3_bot`. It does not loop.

If a folder already has a valid `TELEGRAM_TOKEN`, that bot is skipped.

Acceptance: the script prints `PHASE 2 ACCEPTANCE`. Each of the five folders has a `.env`. `git status` does not list those `.env` files.

## 5. Already exists

Use this when the bot was created earlier and you only need the token stored and verified.

```bash
python fleet/scripts/connect_existing_bot.py mind_observer_bot
```

Replace `mind_observer_bot` with the folder you are connecting. The folder must be one of the five names.

- Press Enter to ask `@BotFather` with `/token`. The script uses the saved session, selects the button that matches the display name or username, and writes the token.
- Or type `paste` and enter the token at the hidden prompt. The session is not required for paste.

The script writes `TELEGRAM_TOKEN` without dropping the other keys, then calls `getMe`.

Acceptance: it prints `Verified getMe` with an id and username, then `ACCEPTANCE`, and it does not print the token.

Repeat for each existing bot you are attaching.

## 6. Phase 3 — scaffold check and the rest of `.env`

The scaffold is already in the clone. Confirm it:

```bash
python - <<'PY'
from pathlib import Path
root = Path("fleet")
need = [
    "README.md", "BLUEPRINT.md", "RECOVERY.md", "requirements.txt",
    ".env.fleet.example", "schemas/state.schema.json", "harness/main.py",
    "scripts/create_session.py", "scripts/mint_bots.py", "scripts/connect_existing_bot.py",
]
bots = ["mind_observer_bot", "mind_spec_bot", "mind_log_bot", "mind_push_bot", "mind_notion_bot"]
files = ["SOUL.md", "STATE.json", "MEMORY.md", "JOURNAL.md", "main.py", ".env.example"]
missing = [str(root / name) for name in need if not (root / name).exists()]
missing += [str(root / bot / name) for bot in bots for name in files if not (root / bot / name).exists()]
print("PHASE 3 ACCEPTANCE" if not missing else "BLOCKED " + ", ".join(missing))
PY
```

Windows PowerShell (same check):

```powershell
python -c "from pathlib import Path; root=Path('fleet'); need=['README.md','BLUEPRINT.md','RECOVERY.md','requirements.txt','.env.fleet.example','schemas/state.schema.json','harness/main.py','scripts/create_session.py','scripts/mint_bots.py','scripts/connect_existing_bot.py']; bots=['mind_observer_bot','mind_spec_bot','mind_log_bot','mind_push_bot','mind_notion_bot']; files=['SOUL.md','STATE.json','MEMORY.md','JOURNAL.md','main.py','.env.example']; missing=[str(root/n) for n in need if not (root/n).exists()]+[str(root/b/f) for b in bots for f in files if not (root/b/f).exists()]; print('PHASE 3 ACCEPTANCE' if not missing else 'BLOCKED '+', '.join(missing))"
```

Minting creates `.env` from `.env.example` and fills `TELEGRAM_TOKEN`. Open each `fleet/<bot>/.env` and fill the empty names. Use the same Notion and OpenAI values in every bot. Use that bot's own token.

```text
TELEGRAM_TOKEN=
NOTION_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=
HUMAN_TELEGRAM_CHAT_ID=
NOTION_PARENT_PAGE_ID=
NOTION_FLEET_STATUS_DB_ID=
NOTION_TASK_QUEUE_DB_ID=
NOTION_ACHIEVEMENT_LOG_DB_ID=
NOTION_GAP_MATRIX_DB_ID=
POLL_INTERVAL_SECONDS=
```

Leave `OPENAI_MODEL` empty to use `gpt-4o-mini`. Leave `POLL_INTERVAL_SECONDS` empty to use 20 seconds, or 1800 seconds for Mind Push. Leave the Notion id fields empty only if Phase 4 search will find exactly one database of each name. Pasting the ids is more reliable.

### Chat id

1. Open `https://t.me/<username>` using the username printed by `getMe`.
2. Send the bot a private message that says `ping`.
3. Before starting the harness, run:

```bash
python fleet/scripts/show_chat_id.py mind_observer_bot
```

4. Copy one printed number into `HUMAN_TELEGRAM_CHAT_ID` in every bot `.env`.

The script prints chat ids only.

Acceptance: Phase 3 prints `PHASE 3 ACCEPTANCE`. Every bot `.env` has a token, Notion token, OpenAI key, and chat id. `git status` still does not list `.env` or session files.

## 7. Phase 4 — Notion structures

Create these under the page **ADRIAN PERSONAL OPERATING SYSTEM**. If that page does not exist, create a page with that exact title first. Do not put secrets on the page.

Create a Notion internal integration at <https://www.notion.so/my-integrations>. Copy its secret into `NOTION_TOKEN` only. Share each database below with that integration (database menu, Share or Connections, invite the integration).

On the parent page, type `/database` and choose **Database - Full page**. Create four databases with these exact names and properties. The title property can stay `Name`.

### Fleet Status

| Property | Type | Options |
| --- | --- | --- |
| Name | title | display name |
| Bot ID | text | the folder id |
| Status | select | `IDLE`, `CLAIMED`, `WORKING`, `HALTED` |
| Last Task | text | |
| Detail | text | |
| Updated At | date | |

Seed five rows. Status is `IDLE`. Last Task and Detail are empty.

| Name | Bot ID |
| --- | --- |
| Mind Observer | `mind_observer_bot` |
| Mind Spec | `mind_spec_bot` |
| Mind Log | `mind_log_bot` |
| Mind Push | `mind_push_bot` |
| Mind Notion | `mind_notion_bot` |

### Task Queue

| Property | Type | Options |
| --- | --- | --- |
| Name | title | task title |
| Assignee | select | `mind_observer_bot`, `mind_spec_bot`, `mind_log_bot`, `mind_push_bot`, `mind_notion_bot` |
| Status | select | `OPEN`, `CLAIMED`, `DONE`, `FAILED`, `BLOCKED` |
| Detail | text | |

### Achievement Log

| Property | Type | Options |
| --- | --- | --- |
| Name | title | the one-line log entry |
| Bot | text | bot id |
| Status | select | `CLAIMED`, `DONE`, `FAILED`, `HALTED`, `READY` |
| When | date | |

### Gap Matrix

| Property | Type | Options |
| --- | --- | --- |
| Name | title | gap name |
| Area | text | |
| Status | select | `OPEN`, `CLOSED` |
| Notes | text | |

The harness does not invent gap rows. It reads Task Queue and writes Fleet Status plus Achievement Log.

Copy each database id from its URL (the 32-character id, hyphens optional) into the matching `NOTION_*_DB_ID` value in every bot `.env`. Copy the parent page id into `NOTION_PARENT_PAGE_ID` if you want search to stay on that page.

Acceptance: the four databases are shared with the integration, Fleet Status has five `IDLE` rows, and the ids are in the local `.env` files only.

## 8. Phase 5 — observer proof

Create one Task Queue row:

| Field | Value |
| --- | --- |
| Name | `Proof of loop` |
| Assignee | `mind_observer_bot` |
| Status | `OPEN` |
| Detail | `Confirm this bot can claim the task, check the OpenAI key and that credits are greater than zero, call the model once, write one journal line, and update state. Do not improvise.` |

Start **only** Mind Observer:

```bash
python fleet/mind_observer_bot/main.py
```

Watch `fleet/mind_observer_bot/JOURNAL.md`, `STATE.json`, and Notion.

Acceptance, in order:

1. `STATE.json` `updated_at` changes before a model call.
2. The task moves to `CLAIMED`.
3. The journal gains a `CLAIMED` line, then a `DONE` line, both in the one-line format.
4. `STATE.json` returns to `status` `IDLE` with `last_task` set and `failure_count` `0`.
5. Fleet Status for Mind Observer returns to `IDLE`.
6. Achievement Log has the same lines.
7. No secret appears in the journal, Notion, or the terminal.

The credit gate calls `GET /v1/models`, then the credit-grants endpoint, then the subscription hard-limit minus month usage if grants do not show a balance above zero. If none of those return a balance greater than zero, the model is not called. That is a failure. A second consecutive failure halts the process and sends the halt line to your chat id.

If the task sticks in `CLAIMED` because you stopped the process, set it back to `OPEN` yourself. That is the human override.

Leave the observer running for the next phase, or restart it after the proof. Do not start the other four until this acceptance passes.

## 9. Phase 6 — the other four, then READY

Start the remaining bots, one process each:

```bash
python fleet/mind_spec_bot/main.py
python fleet/mind_log_bot/main.py
python fleet/mind_push_bot/main.py
python fleet/mind_notion_bot/main.py
```

Mind Push sleeps 30 minutes between polls. That is the schedule. Do not also start a second Mind Push from cron.

Watch for 30 to 60 minutes. You are looking for halt lines, `BLOCKED`, or secrets. An idle bot with no OPEN task stays quiet after its startup line and still refreshes `updated_at`.

When that window is clean, append one READY line to `fleet/mind_observer_bot/JOURNAL.md` and add a matching Achievement Log row:

```text
YYYY-MM-DD HH:MM | mind_observer_bot | READY | five bots running after the monitor window
```

Use the current UTC time. Status `READY` must exist on the Achievement Log select.

Acceptance: all five processes are up, Mind Push's interval is 30 minutes, the READY line exists, and nothing halted.

## 10. Run as services

Run one service per bot. Replace `/path/to/adrians-mind-command-os` with the clone path. The unit reads the gitignored `.env`. It does not contain secret values.

### systemd

`/etc/systemd/system/mind-observer.service`:

```ini
[Unit]
Description=Mind Observer bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/adrians-mind-command-os
EnvironmentFile=/path/to/adrians-mind-command-os/fleet/mind_observer_bot/.env
ExecStart=/path/to/adrians-mind-command-os/.venv/bin/python fleet/mind_observer_bot/main.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Copy that unit for the other bots and change the folder, description, and `ExecStart`. Mind Push uses the same kind of unit. Its 30-minute wait is inside `main.py`. Enable the observer first, confirm Phase 5, then enable the other four.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mind-observer.service
sudo systemctl status mind-observer.service
```

### pm2

From the repository root, with the virtualenv available:

```bash
pm2 start fleet/mind_observer_bot/main.py --interpreter .venv/bin/python --name mind_observer_bot
pm2 start fleet/mind_spec_bot/main.py --interpreter .venv/bin/python --name mind_spec_bot
pm2 start fleet/mind_log_bot/main.py --interpreter .venv/bin/python --name mind_log_bot
pm2 start fleet/mind_push_bot/main.py --interpreter .venv/bin/python --name mind_push_bot
pm2 start fleet/mind_notion_bot/main.py --interpreter .venv/bin/python --name mind_notion_bot
pm2 save
```

On Windows, `pm2` can use `.venv\Scripts\python.exe` as `--interpreter`.

Start the observer and accept Phase 5 before the `pm2 start` lines for the other four.

### nohup (Linux or macOS)

```bash
nohup .venv/bin/python fleet/mind_observer_bot/main.py >> fleet/mind_observer_bot/stdout.log 2>&1 &
```

Repeat for the other `main.py` files after the observer proof. `*.log` is gitignored. The harness does not print tokens. Do not redirect a raw env file into the log.

### Windows process

```powershell
Start-Process -FilePath .\.venv\Scripts\python.exe -ArgumentList "fleet\mind_observer_bot\main.py" -WindowStyle Hidden -RedirectStandardOutput "fleet\mind_observer_bot\stdout.log" -RedirectStandardError "fleet\mind_observer_bot\stderr.log"
```

Repeat with the other four script paths after the observer proof.

## 11. Halt and resume

A halt sets `halted` to true in `STATE.json` and exits. Fix the cause. Then start that bot once with the resume flag:

Linux or macOS:

```bash
FLEET_RESUME=1 python fleet/mind_observer_bot/main.py
```

Windows PowerShell:

```powershell
$env:FLEET_RESUME = "1"
python fleet\mind_observer_bot\main.py
```

Do not put `FLEET_RESUME` in `.env`. A missing `.env` value is `BLOCKED` and does not latch `halted`, so filling the file and starting again is enough.

If a task was left `CLAIMED` or `BLOCKED`, set it back to `OPEN` only when you want it retried.

## 12. What not to commit

Before every commit:

```bash
git status
git check-ignore -v fleet/.env.fleet fleet/mind_observer_bot/.env fleet/fleet_session.session
git check-ignore -v fleet/.env.fleet.example fleet/mind_observer_bot/.env.example
```

The first `check-ignore` must print a matching ignore rule for each secret path. The second must print nothing and exit non-zero, because the examples stay tracked.

Do not commit runtime edits to `STATE.json` or `JOURNAL.md` if you want the seed files to stay empty of live task titles. Those titles are not tokens, but they are still your data.

Search the staged diff for a bot token (`digits:long-token`) or a 32-character hex API hash. If either is present, unstage and remove it. Do not push.
