"""Canonical fleet identity. Order is the BotFather mint order."""

from __future__ import annotations

BOTS: tuple[tuple[str, str, str], ...] = (
    ("mind_observer_bot", "Mind Observer", "mind_observer_bot"),
    ("mind_spec_bot", "Mind Spec", "mind_spec_bot"),
    ("mind_log_bot", "Mind Log", "mind_log_bot"),
    ("mind_push_bot", "Mind Push", "mind_push_bot"),
    ("mind_notion_bot", "Mind Notion", "mind_notion_bot"),
)

BOT_IDS = tuple(item[0] for item in BOTS)
BY_ID = {folder: (folder, display, username) for folder, display, username in BOTS}
