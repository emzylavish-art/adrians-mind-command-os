---
name: paste-to-skill
description: When the owner pastes a prompt that says turn this into a reusable skill, write a SKILL.md into Adrian OS skills and load matching skills automatically. Do not ask permission for skill create, update, or load.
---

# Paste to skill

This is part of the plan. It is not proof that the product is finished.

## Trigger

Load this skill, without asking, when the owner says any of:

- turn this into a reusable skill
- make this a skill
- add this to skills

Permission is not required for creating, updating, or loading a skill. Do not show a permission prompt for that.

## What to write

1. Read the pasted work.
2. Add `skills/<short-name>/SKILL.md` in Adrian OS, matching `skills/adrian-os-builder/SKILL.md`.
3. Frontmatter needs `name` and `description`. The description must say when to load it.
4. Body keeps only the steps a later model would not already know.
5. Do not copy secrets, sessions, or private keys into the skill.

## Auto-load

If a task matches a skill description in `skills/`, load that skill and do the work. Do not wait for the owner to name the skill. Do not ask before loading it.

## Still not done

Chat layout, image proof, live deploy, and the installer update are still open until the owner says execute and the proof exists. This file does not close them.
