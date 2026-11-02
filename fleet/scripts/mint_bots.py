#!/usr/bin/env python3
"""Mint the five fleet bots through @BotFather. Tokens are written, never printed."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    BOTS,
    FLEET_ROOT,
    SESSION_BASE,
    existing_token,
    get_me,
    load_fleet_env,
    print_verification,
    redact,
    require_api_creds,
    silence_library_logs,
    upsert_env,
)
from harness.guard import extract_token, username_refused, retry_username  # noqa: E402


def _refused(text: str) -> bool:
    lowered = (text or "").lower()
    markers = ("too many", "limit", "banned", "cannot", "can't", "blocked")
    return any(marker in lowered for marker in markers)


async def _cancel(conv) -> None:
    await conv.send_message("/cancel")
    try:
        await asyncio.wait_for(conv.get_response(), timeout=15)
    except (asyncio.TimeoutError, TimeoutError):
        return


async def _text(conv) -> str:
    reply = await conv.get_response()
    return reply.raw_text or ""


async def mint_one(client, display_name: str, username: str) -> tuple[str, str]:
    async with client.conversation("@BotFather", timeout=120) as conv:
        await _cancel(conv)
        await conv.send_message("/newbot")
        intro = await _text(conv)
        if _refused(intro):
            print("BLOCKED: @BotFather refused /newbot.")
            print(redact(intro)[:400])
            raise RuntimeError("botfather refused")
        await conv.send_message(display_name)
        named = await _text(conv)
        if "username" not in named.lower() and extract_token(named) is None:
            print(f"BLOCKED: @BotFather did not accept the display name for {display_name}.")
            print(redact(named)[:400])
            raise RuntimeError("name refused")
        await conv.send_message(username)
        issued = await _text(conv)
        chosen = username
        if extract_token(issued) is None and username_refused(issued):
            chosen = retry_username(username)
            print(f"Username unavailable for {display_name}. Retrying once as {chosen}.")
            await conv.send_message(chosen)
            issued = await _text(conv)
        token = extract_token(issued)
        if not token:
            print(f"BLOCKED: @BotFather did not issue a token for {display_name}.")
            print(redact(issued)[:400])
            raise RuntimeError("no token")
        return token, chosen


async def mint_all() -> int:
    silence_library_logs()
    if all(existing_token(FLEET_ROOT / folder) for folder, _display, _username in BOTS):
        print("PHASE 2 ACCEPTANCE: five bots already have TELEGRAM_TOKEN files. No token was printed.")
        return 0
    load_fleet_env()
    api_id, api_hash, _phone = require_api_creds()
    try:
        from telethon import TelegramClient
        from telethon.errors import FloodWaitError
    except ImportError as exc:
        raise SystemExit("BLOCKED: telethon is not installed. Run pip install -r fleet/requirements.txt") from exc

    client = TelegramClient(str(SESSION_BASE), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print("BLOCKED: no authorized session. Run python fleet/scripts/create_session.py first.")
            return 2
        written = 0
        for folder, display_name, username in BOTS:
            bot_dir = FLEET_ROOT / folder
            if existing_token(bot_dir):
                print(f"Skip {folder}: TELEGRAM_TOKEN already present. Value not shown.")
                written += 1
                continue
            print(f"Minting {display_name} ({folder}).")
            try:
                token, chosen = await mint_one(client, display_name, username)
            except FloodWaitError as exc:
                print(f"BLOCKED: Telegram rate limit. Wait {int(exc.seconds)} seconds and run this script again.")
                return 2
            except RuntimeError:
                return 2
            env_path = bot_dir / ".env"
            upsert_env(env_path, "TELEGRAM_TOKEN", token)
            identity = get_me(token)
            print_verification(identity, env_path)
            if identity["username"] and identity["username"] != chosen:
                print(f"Note: Telegram username is {identity['username']}.")
            written += 1
            await asyncio.sleep(1)
        if written != len(BOTS):
            print("BLOCKED: not every bot has a token file.")
            return 2
        print("PHASE 2 ACCEPTANCE: five bots have TELEGRAM_TOKEN files. No token was printed.")
        return 0
    finally:
        await client.disconnect()


def main() -> int:
    if len(sys.argv) != 1:
        print("Usage: python fleet/scripts/mint_bots.py")
        return 2
    return asyncio.run(mint_all())


if __name__ == "__main__":
    raise SystemExit(main())
