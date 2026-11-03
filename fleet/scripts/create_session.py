#!/usr/bin/env python3
"""Create fleet/fleet_session.session. Two steps: request a code, then enter it.

The phone number, login code, 2FA password, and API hash are never printed.
"""

from __future__ import annotations

import asyncio
import getpass
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import SESSION_BASE, load_fleet_env, require_api_creds, silence_library_logs  # noqa: E402


async def create_session() -> int:
    silence_library_logs()
    load_fleet_env()
    api_id, api_hash, phone = require_api_creds()
    try:
        from telethon import TelegramClient
        from telethon.errors import (
            ApiIdInvalidError,
            FloodWaitError,
            PasswordHashInvalidError,
            PhoneCodeExpiredError,
            PhoneCodeInvalidError,
            PhoneNumberInvalidError,
            SessionPasswordNeededError,
        )
    except ImportError as exc:
        raise SystemExit("BLOCKED: telethon is not installed. Run pip install -r fleet/requirements.txt") from exc

    client = TelegramClient(str(SESSION_BASE), api_id, api_hash)
    await client.connect()
    try:
        if await client.is_user_authorized():
            print("PHASE 1 ACCEPTANCE: session already authorized.")
            print("Session file: fleet/fleet_session.session (gitignored, not printed).")
            return 0
        print("Step 1 of 2: requesting a Telegram login code. The phone number is not printed.")
        try:
            sent = await client.send_code_request(phone)
        except FloodWaitError as exc:
            print(f"BLOCKED: Telegram rate limit. Wait {int(exc.seconds)} seconds and run this script again.")
            return 2
        except (ApiIdInvalidError, PhoneNumberInvalidError):
            print("BLOCKED: Telegram rejected TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_PHONE.")
            return 2
        print("Step 2 of 2: enter the login code. Input is hidden. A 2FA password is requested only if the account has one.")
        code = re.sub(r"\s+", "", getpass.getpass("Login code: "))
        if not code:
            print("BLOCKED: no login code entered.")
            return 2
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=sent.phone_code_hash)
        except SessionPasswordNeededError:
            password = getpass.getpass("2FA password: ")
            if not password:
                print("BLOCKED: 2FA password required and none entered.")
                return 2
            try:
                await client.sign_in(password=password)
            except PasswordHashInvalidError:
                print("BLOCKED: Telegram rejected the 2FA password.")
                return 2
        except PhoneCodeInvalidError:
            print("BLOCKED: Telegram rejected the login code.")
            return 2
        except PhoneCodeExpiredError:
            print("BLOCKED: the login code expired. Run this script again.")
            return 2
        except FloodWaitError as exc:
            print(f"BLOCKED: Telegram rate limit. Wait {int(exc.seconds)} seconds and run this script again.")
            return 2
        if not await client.is_user_authorized():
            print("BLOCKED: Telegram did not authorize this session.")
            return 2
        print("PHASE 1 ACCEPTANCE: fleet/fleet_session.session created. It is gitignored. Do not commit it.")
        return 0
    finally:
        await client.disconnect()


def main() -> int:
    if len(sys.argv) != 1:
        print("Usage: python fleet/scripts/create_session.py")
        return 2
    return asyncio.run(create_session())


if __name__ == "__main__":
    raise SystemExit(main())
