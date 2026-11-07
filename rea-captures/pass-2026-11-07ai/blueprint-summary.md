# Blueprint pillars — Adrian's Mind — pass 2026-11-07ai
Live probe (live-probe.txt): /tools 404, /voice 404, /voice-cloning-studio 404, /whisper 404, /activity 404, /scheduled 404; /login 200, /explore 200.
- Whisper Flow: BRANCH-ONLY — whisper-flow 5ab07d0 (unchanged), not on main e4ed639 or prod e3ccc51; /whisper 404.
- Voice Cloning Studio: BRANCH-ONLY — voice-cloning-studio 55d12ec (unchanged), not on main/prod; /voice*, /voice-cloning-studio 404.
- Tool Registry (GodEye only; BlackEye excluded): PARTIAL — in-repo tools/godeye + tools/registry.json work offline (exit 0, requests engine, no screenshot, upstream unconfirmed); no live /tools route (404).
- Continuous evolution: PARTIAL — repo churn continues (rea-features, cursor/worker-mcp-tools-de4c) but no live evolution UI; /activity, /scheduled 404; main idle since 2026-11-05.
