"""Shared fleet loop.

Write STATE.json before thinking. Poll the Notion Task Queue for one OPEN
task assigned to this bot, mark it CLAIMED, confirm the OpenAI key and a
credit balance greater than zero, then call the model once. Log one line to
JOURNAL.md and the Notion Achievement Log. Two consecutive failures halt the
process and alert the human on Telegram. Secrets are redacted before they
reach a log, Notion, or Telegram.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from harness.guard import (
    TOKEN_RE,
    format_log_line,
    one_line,
    redact,
    utc_stamp,
    validate_state,
    write_json_atomic,
)

NOTION_VERSION = "2022-06-28"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_INTERVAL_SECONDS = 20
MIN_INTERVAL_SECONDS = 5


class NotionError(Exception):
    pass


class Notion:
    def __init__(self, token: str) -> None:
        import requests

        self._requests = requests
        self._token = token
        self._databases: dict[str, str] = {}
        self._titles: dict[str, str] = {}

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        try:
            response = self._requests.request(
                method,
                "https://api.notion.com/v1" + path,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Notion-Version": NOTION_VERSION,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=30,
            )
        except self._requests.RequestException as exc:
            raise NotionError("notion unreachable") from exc
        if response.status_code >= 400:
            code = "unknown"
            try:
                parsed = response.json()
                if isinstance(parsed, dict) and parsed.get("code"):
                    code = str(parsed["code"])
            except ValueError:
                code = "unknown"
            raise NotionError(f"notion status={response.status_code} code={code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise NotionError(f"notion status={response.status_code} code=bad_json") from exc
        if not isinstance(body, dict):
            raise NotionError("notion status=200 code=bad_shape")
        return body

    def database_id(self, title: str, env_key: str) -> str:
        preset = os.environ.get(env_key, "").strip()
        if preset:
            return preset
        cached = self._databases.get(title)
        if cached:
            return cached
        body = self._request(
            "POST",
            "/search",
            {"query": title, "filter": {"property": "object", "value": "database"}, "page_size": 10},
        )
        parent_wanted = os.environ.get("NOTION_PARENT_PAGE_ID", "").strip().replace("-", "")
        matches: list[str] = []
        for item in body.get("results") or []:
            if not isinstance(item, dict):
                continue
            if _notion_title(item.get("title")) != title:
                continue
            parent = item.get("parent") if isinstance(item.get("parent"), dict) else {}
            parent_id = str(parent.get("page_id") or "").replace("-", "")
            if parent_wanted and parent_id != parent_wanted:
                continue
            item_id = item.get("id")
            if isinstance(item_id, str) and item_id:
                matches.append(item_id)
        if len(matches) != 1:
            raise NotionError(f"expected one {title} database, found {len(matches)}")
        self._databases[title] = matches[0]
        return matches[0]

    def title_property(self, database_id: str) -> str:
        cached = self._titles.get(database_id)
        if cached:
            return cached
        body = self._request("GET", f"/databases/{database_id}")
        properties = body.get("properties") if isinstance(body.get("properties"), dict) else {}
        for name, prop in properties.items():
            if isinstance(prop, dict) and prop.get("type") == "title":
                self._titles[database_id] = name
                return name
        raise NotionError("database has no title property")

    def open_task(self, bot_id: str) -> dict[str, str] | None:
        database_id = self.database_id("Task Queue", "NOTION_TASK_QUEUE_DB_ID")
        body = self._request(
            "POST",
            f"/databases/{database_id}/query",
            {
                "page_size": 1,
                "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
                "filter": {
                    "and": [
                        {"property": "Status", "select": {"equals": "OPEN"}},
                        {"property": "Assignee", "select": {"equals": bot_id}},
                    ]
                },
            },
        )
        results = [item for item in (body.get("results") or []) if isinstance(item, dict)]
        if not results:
            return None
        page = results[0]
        properties = page.get("properties") if isinstance(page.get("properties"), dict) else {}
        title_key = self.title_property(database_id)
        page_id = str(page.get("id") or "")
        if not page_id:
            raise NotionError("task page has no id")
        return {
            "id": page_id,
            "title": _plain(properties.get(title_key)) or "untitled task",
            "detail": _plain(properties.get("Detail")),
        }

    def set_task_status(self, page_id: str, status: str) -> None:
        self._request(
            "PATCH",
            f"/pages/{page_id}",
            {"properties": {"Status": {"select": {"name": status}}}},
        )

    def update_fleet(self, bot_id: str, status: str, last_task: str, detail: str) -> None:
        database_id = self.database_id("Fleet Status", "NOTION_FLEET_STATUS_DB_ID")
        body = self._request(
            "POST",
            f"/databases/{database_id}/query",
            {
                "page_size": 2,
                "filter": {"property": "Bot ID", "rich_text": {"equals": bot_id}},
            },
        )
        results = [item for item in (body.get("results") or []) if isinstance(item, dict) and item.get("id")]
        if len(results) != 1:
            raise NotionError(f"expected one Fleet Status row for {bot_id}, found {len(results)}")
        self._request(
            "PATCH",
            f"/pages/{results[0]['id']}",
            {
                "properties": {
                    "Status": {"select": {"name": status}},
                    "Last Task": {"rich_text": _rich(one_line(last_task, 180)) if last_task.strip() else []},
                    "Detail": {"rich_text": _rich(one_line(detail, 180))},
                    "Updated At": {"date": {"start": utc_stamp()}},
                }
            },
        )

    def achievement(self, bot_id: str, status: str, line: str) -> None:
        database_id = self.database_id("Achievement Log", "NOTION_ACHIEVEMENT_LOG_DB_ID")
        title_key = self.title_property(database_id)
        self._request(
            "POST",
            "/pages",
            {
                "parent": {"database_id": database_id},
                "properties": {
                    title_key: {"title": _rich(line)},
                    "Bot": {"rich_text": _rich(bot_id)},
                    "Status": {"select": {"name": status}},
                    "When": {"date": {"start": utc_stamp()}},
                },
            },
        )


def _rich(text: str) -> list[dict[str, dict[str, str]]]:
    return [{"text": {"content": one_line(text, 1800)}}]


def _plain(prop: object) -> str:
    if not isinstance(prop, dict):
        return ""
    chunks = prop.get("title") or prop.get("rich_text") or []
    if not isinstance(chunks, list):
        return ""
    return "".join(str(part.get("plain_text") or "") for part in chunks if isinstance(part, dict)).strip()


def _notion_title(value: object) -> str:
    if not isinstance(value, list):
        return ""
    return "".join(str(part.get("plain_text") or "") for part in value if isinstance(part, dict)).strip()


@dataclass
class Ctx:
    root: Path
    bot_id: str
    state_path: Path
    journal_path: Path
    state: dict
    notion: Notion
    secrets: list[str]
    soul: str
    token: str
    chat_id: str
    openai_key: str
    model: str


def _append_journal(path: Path, line: str) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    prefix = "" if (not existing or existing.endswith("\n")) else "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(prefix + line + "\n")


def _emit(ctx: Ctx, status: str, detail: str) -> str:
    line = format_log_line(ctx.bot_id, status, redact(detail, ctx.secrets))
    _append_journal(ctx.journal_path, line)
    print(line, flush=True)
    return line


def _persist(ctx: Ctx) -> None:
    errors = validate_state(ctx.state)
    if errors:
        raise SystemExit("BLOCKED: refusing to write invalid state: " + "; ".join(errors))
    ctx.state["updated_at"] = utc_stamp()
    write_json_atomic(ctx.state_path, ctx.state)


def _secret_values() -> list[str]:
    names = (
        "TELEGRAM_TOKEN",
        "NOTION_TOKEN",
        "OPENAI_API_KEY",
        "TELEGRAM_API_HASH",
        "TELEGRAM_PHONE",
        "HUMAN_TELEGRAM_CHAT_ID",
    )
    return [os.environ[name].strip() for name in names if len(os.environ.get(name, "").strip()) >= 8]


def _settings_problem() -> str | None:
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    notion = os.environ.get("NOTION_TOKEN", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    chat_id = os.environ.get("HUMAN_TELEGRAM_CHAT_ID", "").strip()
    if TOKEN_RE.fullmatch(token) is None:
        return "TELEGRAM_TOKEN is missing or invalid"
    if len(notion) < 20:
        return "NOTION_TOKEN is missing or invalid"
    if len(openai_key) < 20:
        return "OPENAI_API_KEY is missing or invalid"
    if re.fullmatch(r"-?\d{3,20}", chat_id) is None:
        return "HUMAN_TELEGRAM_CHAT_ID is missing or not a numeric chat id"
    return None


def _interval(explicit: int | None) -> int:
    raw = os.environ.get("POLL_INTERVAL_SECONDS", "").strip()
    if raw:
        if not raw.isdigit():
            raise SystemExit("BLOCKED: POLL_INTERVAL_SECONDS must be a positive integer")
        value = int(raw)
    elif explicit is not None:
        value = explicit
    else:
        value = DEFAULT_INTERVAL_SECONDS
    if value < MIN_INTERVAL_SECONDS:
        raise SystemExit(f"BLOCKED: poll interval must be at least {MIN_INTERVAL_SECONDS} seconds")
    return value


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_lock(bot_id: str) -> Path:
    path = Path(tempfile.gettempdir()) / f"adrians-mind-fleet-{bot_id}.lock"
    if path.exists():
        raw = path.read_text(encoding="utf-8").strip()
        if raw.isdigit() and int(raw) != os.getpid() and _pid_alive(int(raw)):
            raise SystemExit(f"BLOCKED: {bot_id} is already running as pid {raw}")
    path.write_text(str(os.getpid()), encoding="utf-8")

    def _release() -> None:
        try:
            if path.exists() and path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                path.unlink()
        except OSError:
            return

    atexit.register(_release)
    return path


def check_openai(api_key: str) -> tuple[bool, str]:
    import requests

    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        models = requests.get("https://api.openai.com/v1/models", headers=headers, timeout=30)
    except requests.RequestException:
        return False, "openai key check could not reach the network"
    if models.status_code != 200:
        return False, f"openai key check status={models.status_code}"
    remaining = _credit_remaining(api_key)
    if remaining is None:
        return False, "openai credit check did not return a balance"
    if remaining <= 0:
        return False, "openai credits are not greater than zero"
    return True, "openai key accepted and credits are greater than zero"


def _credit_remaining(api_key: str) -> float | None:
    import requests

    headers = {"Authorization": f"Bearer {api_key}"}
    grant_urls = (
        "https://api.openai.com/dashboard/billing/credit_grants",
        "https://api.openai.com/v1/dashboard/billing/credit_grants",
    )
    for url in grant_urls:
        available = _available_from_grants(requests, url, headers)
        if available is not None and available > 0:
            return available
    subscription = _subscription_remaining(requests, headers)
    if subscription is not None:
        return subscription
    for url in grant_urls:
        available = _available_from_grants(requests, url, headers)
        if available is not None:
            return available
    return None


def _available_from_grants(requests_module, url: str, headers: dict[str, str]) -> float | None:
    try:
        response = requests_module.get(url, headers=headers, timeout=30)
    except requests_module.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    if isinstance(body.get("total_available"), (int, float)) and not isinstance(body.get("total_available"), bool):
        return float(body["total_available"])
    grants = body.get("grants")
    data = grants.get("data") if isinstance(grants, dict) else None
    if not isinstance(data, list):
        return None
    remaining = 0.0
    found = False
    for grant in data:
        if not isinstance(grant, dict):
            continue
        amount = grant.get("grant_amount")
        used = grant.get("used_amount")
        if isinstance(amount, (int, float)) and isinstance(used, (int, float)):
            remaining += float(amount) - float(used)
            found = True
    return remaining if found else None


def _subscription_remaining(requests_module, headers: dict[str, str]) -> float | None:
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    start = today.replace(day=1).isoformat()
    end = today.isoformat()
    hard_limit = None
    for url in (
        "https://api.openai.com/dashboard/billing/subscription",
        "https://api.openai.com/v1/dashboard/billing/subscription",
    ):
        try:
            response = requests_module.get(url, headers=headers, timeout=30)
        except requests_module.RequestException:
            continue
        if response.status_code != 200:
            continue
        try:
            body = response.json()
        except ValueError:
            continue
        if isinstance(body, dict) and isinstance(body.get("hard_limit_usd"), (int, float)):
            hard_limit = float(body["hard_limit_usd"])
            break
    if hard_limit is None:
        return None
    used = 0.0
    for url in (
        "https://api.openai.com/dashboard/billing/usage",
        "https://api.openai.com/v1/dashboard/billing/usage",
    ):
        try:
            response = requests_module.get(url, headers=headers, params={"start_date": start, "end_date": end}, timeout=30)
        except requests_module.RequestException:
            continue
        if response.status_code != 200:
            continue
        try:
            body = response.json()
        except ValueError:
            continue
        if isinstance(body, dict) and isinstance(body.get("total_usage"), (int, float)):
            used = float(body["total_usage"]) / 100.0
            return hard_limit - used
    return None


def call_model(ctx: Ctx, title: str, detail: str) -> str:
    from openai import OpenAI

    task = title if not detail else f"{title}\n{detail}"
    task = redact(task, ctx.secrets)[:4000]
    client = OpenAI(api_key=ctx.openai_key, timeout=60)
    response = client.chat.completions.create(
        model=ctx.model,
        temperature=0,
        max_tokens=200,
        messages=[
            {"role": "system", "content": ctx.soul},
            {
                "role": "user",
                "content": "Assigned task follows. Execute only this task. Reply with one line and no secrets.\n" + task,
            },
        ],
    )
    content = response.choices[0].message.content if response.choices else ""
    return content or ""


def _alert(ctx: Ctx, line: str) -> None:
    import requests

    text = redact(line, ctx.secrets)
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{ctx.token}/sendMessage",
            json={"chat_id": ctx.chat_id, "text": text},
            timeout=30,
        )
    except requests.RequestException:
        notice = format_log_line(ctx.bot_id, "HALTED", "alert could not reach Telegram")
        _append_journal(ctx.journal_path, notice)
        print(notice, flush=True)
        return
    if response.status_code != 200:
        notice = format_log_line(ctx.bot_id, "HALTED", f"alert status={response.status_code}")
        _append_journal(ctx.journal_path, notice)
        print(notice, flush=True)


def _record_notion(ctx: Ctx, status: str, line: str, task: dict[str, str] | None, fleet_status: str) -> None:
    task_status = {"CLAIMED": "CLAIMED", "DONE": "DONE", "FAILED": "OPEN", "HALTED": "BLOCKED", "BLOCKED": "BLOCKED"}[status]
    ctx.notion.update_fleet(ctx.bot_id, fleet_status, str(ctx.state.get("last_task") or ""), line)
    ctx.notion.achievement(ctx.bot_id, status, line)
    if task is not None:
        ctx.notion.set_task_status(task["id"], task_status)


def _fail(ctx: Ctx, reason: str, task: dict[str, str] | None) -> str:
    ctx.state["failure_count"] = int(ctx.state.get("failure_count") or 0) + 1
    ctx.state["last_error"] = one_line(redact(reason, ctx.secrets))
    halt = ctx.state["failure_count"] >= 2
    ctx.state["halted"] = halt
    ctx.state["status"] = "HALTED" if halt else "IDLE"
    _persist(ctx)
    status = "HALTED" if halt else "FAILED"
    line = _emit(ctx, status, ctx.state["last_error"])
    try:
        _record_notion(ctx, status, line, task, "HALTED" if halt else "IDLE")
    except NotionError as exc:
        notice = _emit(ctx, status, "notion update failed " + str(exc))
        del notice
    if halt:
        _alert(ctx, line)
        return "halt"
    return "failed"


def one_cycle(ctx: Ctx) -> str:
    # Write the current state before deciding what the next task means.
    _persist(ctx)
    try:
        task = ctx.notion.open_task(ctx.bot_id)
    except NotionError as exc:
        return _fail(ctx, str(exc), None)
    if task is None:
        return "idle"
    ctx.state["status"] = "CLAIMED"
    ctx.state["last_task"] = one_line(redact(task["title"], ctx.secrets), 180)
    ctx.state["cycle"] = int(ctx.state.get("cycle") or 0) + 1
    _persist(ctx)
    claimed = _emit(ctx, "CLAIMED", ctx.state["last_task"])
    try:
        _record_notion(ctx, "CLAIMED", claimed, task, "CLAIMED")
    except NotionError as exc:
        return _fail(ctx, str(exc), task)
    ready, reason = check_openai(ctx.openai_key)
    if not ready:
        return _fail(ctx, reason, task)
    ctx.state["status"] = "WORKING"
    _persist(ctx)
    try:
        result = call_model(ctx, task["title"], task["detail"])
    except ImportError:
        return _fail(ctx, "openai package is not installed", task)
    except Exception as exc:
        status_code = getattr(exc, "status_code", None)
        if status_code:
            return _fail(ctx, f"openai model call status={status_code}", task)
        return _fail(ctx, "openai model call failed", task)
    detail = one_line(redact(result, ctx.secrets))
    if detail == "no detail":
        return _fail(ctx, "empty model result", task)
    ctx.state["status"] = "IDLE"
    ctx.state["last_result"] = detail
    ctx.state["last_error"] = None
    ctx.state["failure_count"] = 0
    ctx.state["halted"] = False
    done = format_log_line(ctx.bot_id, "DONE", detail)
    try:
        _record_notion(ctx, "DONE", done, task, "IDLE")
    except NotionError as exc:
        return _fail(ctx, str(exc), task)
    _persist(ctx)
    _append_journal(ctx.journal_path, done)
    print(done, flush=True)
    return "done"


def run(config_root: Path, poll_interval_seconds: int | None = None) -> int:
    root = config_root.resolve()
    try:
        from dotenv import load_dotenv
    except ImportError as exc:
        raise SystemExit("BLOCKED: python-dotenv is not installed. Run pip install -r fleet/requirements.txt") from exc
    env_path = root / ".env"
    if env_path.is_file():
        load_dotenv(env_path, override=True)
    state_path = root / "STATE.json"
    journal_path = root / "JOURNAL.md"
    soul_path = root / "SOUL.md"
    if not state_path.is_file():
        raise SystemExit(f"BLOCKED: {root.name}/STATE.json is missing")
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise SystemExit(f"BLOCKED: {root.name}/STATE.json is not valid JSON")
    errors = validate_state(state)
    if errors:
        raise SystemExit("BLOCKED: " + "; ".join(errors))
    if state["bot_id"] != root.name:
        raise SystemExit(f"BLOCKED: STATE.json bot_id does not match folder {root.name}")
    if not soul_path.is_file():
        raise SystemExit(f"BLOCKED: {root.name}/SOUL.md is missing")
    interval = _interval(poll_interval_seconds)
    _acquire_lock(state["bot_id"])
    state["updated_at"] = utc_stamp()
    write_json_atomic(state_path, state)
    if state["halted"] and os.environ.get("FLEET_RESUME", "").strip() != "1":
        line = format_log_line(state["bot_id"], "HALTED", "still halted; set FLEET_RESUME=1 to clear")
        _append_journal(journal_path, line)
        print(line, flush=True)
        return 2
    if state["halted"]:
        state["halted"] = False
        state["failure_count"] = 0
        state["status"] = "IDLE"
        state["last_error"] = None
        state["updated_at"] = utc_stamp()
        write_json_atomic(state_path, state)
    problem = _settings_problem()
    if problem:
        line = format_log_line(state["bot_id"], "BLOCKED", problem)
        _append_journal(journal_path, line)
        print(line, flush=True)
        state["last_error"] = problem
        state["updated_at"] = utc_stamp()
        write_json_atomic(state_path, state)
        return 2
    try:
        notion = Notion(os.environ["NOTION_TOKEN"].strip())
    except ImportError as exc:
        raise SystemExit("BLOCKED: requests is not installed. Run pip install -r fleet/requirements.txt") from exc
    ctx = Ctx(
        root=root,
        bot_id=state["bot_id"],
        state_path=state_path,
        journal_path=journal_path,
        state=state,
        notion=notion,
        secrets=_secret_values(),
        soul=soul_path.read_text(encoding="utf-8")[:6000],
        token=os.environ["TELEGRAM_TOKEN"].strip(),
        chat_id=os.environ["HUMAN_TELEGRAM_CHAT_ID"].strip(),
        openai_key=os.environ["OPENAI_API_KEY"].strip(),
        model=os.environ.get("OPENAI_MODEL", "").strip() or DEFAULT_MODEL,
    )
    _emit(ctx, "IDLE", f"harness started; poll every {interval} seconds")
    try:
        while True:
            outcome = one_cycle(ctx)
            if outcome == "halt":
                return 2
            time.sleep(interval)
    except KeyboardInterrupt:
        line = format_log_line(ctx.bot_id, "CLAIMED" if ctx.state["status"] == "CLAIMED" else ctx.state["status"], "stopped by keyboard interrupt")
        _append_journal(journal_path, line)
        print(line, flush=True)
        _persist(ctx)
        return 0


def main() -> int:
    print("BLOCKED: start a bot with python fleet/<bot_folder>/main.py")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
