#!/usr/bin/env python3
"""Attach an existing BotFather bot to a fleet folder.

Press Enter to ask @BotFather with /token, or type paste and enter the token
at the hidden prompt. The token is written to fleet/<bot>/.env and checked
with getMe. It is never printed.
"""

from __future__ import annotations

import asyncio
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    BOTS,
    BY_ID,
    SESSION_BASE,
    get_me,
    load_fleet_env,
    print_verification,
    redact,
    require_api_creds,
    resolve_bot_dir,
    silence_library_logs,
    upsert_env,
)
from harness.guard import TOKEN_RE, extract_token  # noqa: E402


def _labels(message) -> list[str]:
    labels: list[str] = []
    for row in getattr(message, "buttons", None) or []:
        for button in row:
            text = getattr(button, "text", "") or ""
            if text:
                labels.append(text)
    return labels


async def _click_match(message, display_name: str, username: str) -> bool:
    labels = _labels(message)
    for label in labels:
        lowered = label.lower()
        if display_name.lower() in lowered or username.lower() in lowered:
            await message.click(text=label)
            return True
    return False


async def token_from_botfather(display_name: str, username: str) -> str | None:
    silence_library_logs()
    load_fleet_env()
    api_id, api_hash, _phone = require_api_creds()
    try:
        from telethon import TelegramClient
    except ImportError as exc:
        raise SystemExit("BLOCKED: telethon is not installed. Run pip install -r fleet/requirements.txt") from exc

    client = TelegramClient(str(SESSION_BASE), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print("BLOCKED: no authorized session. Run create_session.py, or type paste at the prompt.")
            return None
        async with client.conversation("@BotFather", timeout=90) as conv:
            await conv.send_message("/cancel")
            try:
                await asyncio.wait_for(conv.get_response(), timeout=15)
            except (asyncio.TimeoutError, TimeoutError):
                pass
            await conv.send_message("/token")
            reply = await conv.get_response()
            token = extract_token(reply.raw_text or "")
            if token:
                return token
            clicked = False
            try:
                clicked = await _click_match(reply, display_name, username)
            except Exception as exc:
                print("BLOCKED: could not select the bot button.")
                print(redact(str(exc))[:200])
                return None
            if not clicked:
                await conv.send_message("@" + username)
            reply = await conv.get_response()
            token = extract_token(reply.raw_text or "")
            if token:
                return token
            if getattr(reply, "buttons", None):
                try:
                    clicked = await _click_match(reply, display_name, username)
                except Exception:
                    clicked = False
                if clicked:
                    reply = await conv.get_response()
                    token = extract_token(reply.raw_text or "")
                    if token:
                        return token
            print("BLOCKED: @BotFather did not return a token. Type paste on the next run to enter it yourself.")
            print(redact(reply.raw_text or "")[:400])
            return None
    finally:
        await client.disconnect()


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in {"-h", "--help"}:
        names = ", ".join(item[0] for item in BOTS)
        print("Usage: python fleet/scripts/connect_existing_bot.py <bot_folder>")
        print("Bot folders: " + names)
        return 0 if len(sys.argv) == 2 else 2
    bot_dir = resolve_bot_dir(sys.argv[1])
    _folder, display_name, username = BY_ID[bot_dir.name]
    choice = input("Press Enter to ask @BotFather (/token), or type paste: ").strip().lower()
    if choice == "paste":
        token = getpass.getpass("Paste the existing bot token (input hidden): ").strip()
    elif choice == "":
        token = asyncio.run(token_from_botfather(display_name, username)) or ""
    else:
        print("BLOCKED: expected Enter or paste.")
        return 2
    if TOKEN_RE.fullmatch(token or "") is None:
        print("BLOCKED: that did not look like a Telegram bot token. Nothing written.")
        return 2
    env_path = bot_dir / ".env"
    upsert_env(env_path, "TELEGRAM_TOKEN", token)
    identity = get_me(token)
    print_verification(identity, env_path)
    print(f"ACCEPTANCE: {bot_dir.name} token stored and getMe succeeded. Token not shown.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
