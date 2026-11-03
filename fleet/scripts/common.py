"""Shared helpers for the fleet setup scripts. Never print secret values."""

from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path

FLEET_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = FLEET_ROOT.parent
SESSION_BASE = FLEET_ROOT / "fleet_session"

if str(FLEET_ROOT) not in sys.path:
    sys.path.insert(0, str(FLEET_ROOT))

from harness.bots import BOT_IDS, BOTS, BY_ID  # noqa: E402
from harness.guard import TOKEN_RE, extract_token, redact  # noqa: E402


def silence_library_logs() -> None:
    logging.basicConfig(level=logging.ERROR)
    logging.getLogger("telethon").setLevel(logging.ERROR)
    logging.getLogger("urllib3").setLevel(logging.ERROR)
    logging.getLogger("httpx").setLevel(logging.ERROR)


def load_fleet_env() -> None:
    env_path = FLEET_ROOT / ".env.fleet"
    if not env_path.is_file():
        raise SystemExit("BLOCKED: fleet/.env.fleet is missing. Copy fleet/.env.fleet.example and fill the three names.")
    try:
        from dotenv import load_dotenv
    except ImportError as exc:
        raise SystemExit("BLOCKED: python-dotenv is not installed. Run pip install -r fleet/requirements.txt") from exc
    load_dotenv(env_path, override=True)


def require_api_creds() -> tuple[int, str, str]:
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    phone = os.environ.get("TELEGRAM_PHONE", "").strip()
    missing = [
        name
        for name, value in (
            ("TELEGRAM_API_ID", api_id),
            ("TELEGRAM_API_HASH", api_hash),
            ("TELEGRAM_PHONE", phone),
        )
        if not value
    ]
    if missing:
        raise SystemExit("BLOCKED: missing " + ", ".join(missing))
    if not api_id.isdigit():
        raise SystemExit("BLOCKED: TELEGRAM_API_ID must be digits from my.telegram.org")
    if re.fullmatch(r"[0-9a-fA-F]{32}", api_hash) is None:
        raise SystemExit("BLOCKED: TELEGRAM_API_HASH must be the 32 character hex value from my.telegram.org")
    return int(api_id), api_hash, phone


def private_write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def upsert_env(path: Path, key: str, value: str) -> None:
    example = path.with_name(".env.example")
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    elif path.name == ".env" and example.is_file():
        lines = example.read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    prefix = key + "="
    found = False
    updated: list[str] = []
    for line in lines:
        if line.startswith(prefix):
            updated.append(prefix + value)
            found = True
        else:
            updated.append(line)
    if not found:
        updated.append(prefix + value)
    private_write(path, "\n".join(updated) + "\n")


def existing_token(bot_dir: Path) -> bool:
    env_path = bot_dir / ".env"
    if not env_path.is_file():
        return False
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("TELEGRAM_TOKEN="):
            continue
        value = line.split("=", 1)[1].strip().strip('"').strip("'")
        return extract_token(value) == value and bool(value)
    return False


def resolve_bot_dir(argument: str) -> Path:
    name = Path(argument).name
    if name not in BOT_IDS:
        raise SystemExit("BLOCKED: bot folder must be one of: " + ", ".join(BOT_IDS))
    path = FLEET_ROOT / name
    if not path.is_dir():
        raise SystemExit(f"BLOCKED: {name} is not a fleet bot folder")
    return path


def get_me(token: str) -> dict[str, str | int]:
    if TOKEN_RE.fullmatch(token or "") is None:
        raise SystemExit("BLOCKED: the token did not match a Telegram bot token. Nothing was verified.")
    try:
        import requests
    except ImportError as exc:
        raise SystemExit("BLOCKED: requests is not installed. Run pip install -r fleet/requirements.txt") from exc
    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=30)
    except requests.RequestException:
        raise SystemExit("BLOCKED: getMe could not reach Telegram.")
    if response.status_code != 200:
        raise SystemExit(f"BLOCKED: getMe status={response.status_code}")
    try:
        body = response.json()
    except ValueError:
        raise SystemExit("BLOCKED: getMe returned a non-JSON body")
    result = body.get("result") if isinstance(body, dict) else None
    if not isinstance(result, dict) or not result.get("id"):
        raise SystemExit("BLOCKED: getMe did not return a bot id")
    return {
        "id": result.get("id"),
        "username": str(result.get("username") or ""),
        "first_name": str(result.get("first_name") or ""),
    }


def print_verification(identity: dict[str, str | int], env_path: Path) -> None:
    relative = env_path
    try:
        relative = env_path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        pass
    print(
        "Verified getMe"
        f" id={identity['id']}"
        f" username={identity['username']}"
        f" name={identity['first_name']}"
    )
    print(f"Wrote TELEGRAM_TOKEN to {relative.as_posix()} (value not shown)")


def safe_error(exc: BaseException) -> str:
    return redact(f"{type(exc).__name__}")[:120]
