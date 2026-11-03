"""Secret redaction, log lines, and STATE.json checks. No network imports."""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

TOKEN_RE = re.compile(r"\d{6,12}:[A-Za-z0-9_-]{30,}")

REQUIRED_STATE_KEYS = (
    "bot_id",
    "display_name",
    "status",
    "last_task",
    "last_result",
    "last_error",
    "failure_count",
    "halted",
    "updated_at",
    "cycle",
)

STATUS_VALUES = frozenset({"IDLE", "CLAIMED", "WORKING", "HALTED"})


def extract_token(text: str) -> str | None:
    match = TOKEN_RE.search(text or "")
    return match.group(0) if match else None


def redact(text: str, secrets_to_hide: list[str] | tuple[str, ...] | None = None) -> str:
    """Remove bot tokens and any caller-supplied secret values."""
    cleaned = TOKEN_RE.sub("[REDACTED]", text or "")
    cleaned = re.sub(r"bot\d{6,12}:[A-Za-z0-9_-]+", "bot[REDACTED]", cleaned)
    values = [item for item in (secrets_to_hide or ()) if item and len(item) >= 8]
    for secret in sorted(set(values), key=len, reverse=True):
        cleaned = cleaned.replace(secret, "[REDACTED]")
    return cleaned


def one_line(text: str, limit: int = 240) -> str:
    collapsed = " ".join((text or "").split()).replace("|", "/")
    if not collapsed:
        return "no detail"
    if len(collapsed) > limit:
        return collapsed[: limit - 3] + "..."
    return collapsed


def format_log_line(bot: str, status: str, detail: str, when: datetime | None = None) -> str:
    moment = when or datetime.now(timezone.utc)
    stamp = moment.strftime("%Y-%m-%d %H:%M")
    return f"{stamp} | {bot} | {status} | {one_line(detail)}"


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def retry_username(username: str) -> str:
    """One replacement username. Telegram requires the name to end in bot."""
    base = username.strip().lstrip("@")
    stem = base[:-3] if base.lower().endswith("bot") else base
    stem = stem.rstrip("_") or "mind"
    return f"{stem}_{secrets.token_hex(3)}_bot"


def username_refused(text: str) -> bool:
    lowered = (text or "").lower()
    phrases = (
        "already taken",
        "username is invalid",
        "must end in bot",
        "must end with bot",
        "too short",
        "occupied",
        "not available",
    )
    return any(phrase in lowered for phrase in phrases)


def validate_state(state: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(state, dict):
        return ["state is not an object"]
    for key in REQUIRED_STATE_KEYS:
        if key not in state:
            errors.append(f"missing {key}")
    unknown = sorted(set(state) - set(REQUIRED_STATE_KEYS))
    if unknown:
        errors.append("unknown keys: " + ", ".join(unknown))
    if not isinstance(state.get("bot_id"), str) or not state.get("bot_id"):
        errors.append("bot_id must be a non-empty string")
    if not isinstance(state.get("display_name"), str) or not state.get("display_name"):
        errors.append("display_name must be a non-empty string")
    if state.get("status") not in STATUS_VALUES:
        errors.append("status is not allowed")
    for key in ("last_task", "last_result", "last_error", "updated_at"):
        value = state.get(key)
        if value is not None and not isinstance(value, str):
            errors.append(f"{key} must be a string or null")
    failure_count = state.get("failure_count")
    cycle = state.get("cycle")
    if isinstance(failure_count, bool) or not isinstance(failure_count, int) or failure_count < 0:
        errors.append("failure_count must be a non-negative integer")
    if isinstance(cycle, bool) or not isinstance(cycle, int) or cycle < 0:
        errors.append("cycle must be a non-negative integer")
    if not isinstance(state.get("halted"), bool):
        errors.append("halted must be a boolean")
    return errors


def write_json_atomic(path: Path, payload: object) -> None:
    text = json.dumps(payload, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def _self_check() -> int:
    fake_token = "123456789:" + ("A" * 35)
    if extract_token("token " + fake_token + " end") != fake_token:
        print("BLOCKED: extract_token failed")
        return 1
    if "[REDACTED]" not in redact("see " + fake_token + " here"):
        print("BLOCKED: redact failed")
        return 1
    hidden = "ab" * 16
    if redact("hash " + hidden, [hidden]) != "hash [REDACTED]":
        print("BLOCKED: secret redact failed")
        return 1
    retried = retry_username("mind_observer_bot")
    if retried == "mind_observer_bot" or not retried.endswith("_bot"):
        print("BLOCKED: retry username failed")
        return 1
    line = format_log_line(
        "mind_observer_bot",
        "DONE",
        "hello\nthere",
        when=datetime(2026, 11, 2, 12, 30, tzinfo=timezone.utc),
    )
    expected = "2026-11-02 12:30 | mind_observer_bot | DONE | hello there"
    if line != expected:
        print("BLOCKED: log format failed")
        return 1
    root = Path(__file__).resolve().parents[1]
    failed = False
    for path in sorted(root.glob("*/STATE.json")):
        errors = validate_state(json.loads(path.read_text(encoding="utf-8")))
        if errors:
            print(f"BLOCKED: {path.parent.name} STATE.json {errors}")
            failed = True
    if failed:
        return 1
    print("guard self-check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(_self_check())
