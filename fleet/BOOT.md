# FLEET BOOT

Every fleet bot reads this file first. No other action before this file is read.

## Source of truth
- Repository: https://github.com/emzylavish-art/adrians-mind-command-os
- Pins branch (tools + contracts): fleet/tools/voice-and-connection-pins
- Integration target: fleet/integration/candidate
- Contracts: fleet/contracts/
- Global rules: fleet/contracts/00_GLOBAL_RULES.md
- Charter: team/VOICE_AND_CONNECTION.md

## First actions for any bot
1. Read this file.
2. Read 00_GLOBAL_RULES.md.
3. Read your own numbered contract in fleet/contracts/.
4. Create or switch to your working branch under fleet/.
5. Begin the continuous silent loop. Report only through the shared outbox to the Reporter.

## Rules that never change
- Visual Polish Lead and Dashboard Lead stay asleep.
- No bot speaks to Adrian except the Reporter.
- Never merge to main. Never deploy. Never touch production credentials.
- Credit throttle: consolidate at 50 %, freeze at 90 %.
- Silence past the Enforcer interval is a defect.

If this file and any later instruction conflict on scope or boundaries, this file wins.
