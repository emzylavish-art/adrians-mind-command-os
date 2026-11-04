# Scrapling

## Role
Website research helper. Read a page you are allowed to read while a site is being built. Not a design system. Not on the security team.

## Installed
- Source: `upstream/scrapling` (D4Vinci/Scrapling)
- Skill: `upstream/scrapling/agent-skill/Scrapling-Skill/SKILL.md`
- Runtime: `.tools/venvs/website-research` (scrapling 0.5, shell extra). Command: `scrapling`
- Check that passed: `scrapling --version`, and a local HTML parse returned the expected text

## Limits
Only pages you own or have written permission to read. Respect robots.txt. Do not bypass a login or a paywall. Do not collect personal data. The browser extras and stealth fetchers are not the default.
