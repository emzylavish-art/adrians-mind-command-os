#!/usr/bin/env python3
"""Print numeric Telegram chat ids from getUpdates. Never print the token or message text."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import BOTS, resolve_bot_dir  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in {"-h", "--help"}:
        names = ", ".join(item[0] for item in BOTS)
        print("Usage: python fleet/scripts/show_chat_id.py <bot_folder>")
        print("Bot folders: " + names)
        print("Send the bot a private message that says ping before running this.")
        return 0 if len(sys.argv) == 2 else 2
    bot_dir = resolve_bot_dir(sys.argv[1])
    env_path = bot_dir / ".env"
    if not env_path.is_file():
        print("BLOCKED: .env is missing for that bot.")
        return 2
    try:
        from dotenv import dotenv_values
        import requests
    except ImportError as exc:
        raise SystemExit("BLOCKED: install fleet/requirements.txt first") from exc
    values = dotenv_values(env_path)
    token = str(values.get("TELEGRAM_TOKEN") or "").strip()
    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", timeout=30)
    except requests.RequestException:
        print("BLOCKED: getUpdates could not reach Telegram.")
        return 2
    if response.status_code != 200:
        print(f"BLOCKED: getUpdates status={response.status_code}")
        return 2
    try:
        body = response.json()
    except ValueError:
        print("BLOCKED: getUpdates returned a non-JSON body")
        return 2
    ids: list[int] = []
    for update in body.get("result") or []:
        if not isinstance(update, dict):
            continue
        message = update.get("message") if isinstance(update.get("message"), dict) else {}
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = chat.get("id")
        if isinstance(chat_id, int) and chat_id not in ids:
            ids.append(chat_id)
    if not ids:
        print("BLOCKED: no chat id yet. Open the bot in Telegram, send ping, then run this again.")
        return 2
    print("HUMAN_TELEGRAM_CHAT_ID candidates:")
    for chat_id in ids:
        print(chat_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
