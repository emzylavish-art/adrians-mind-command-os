H11 DONE — voice server input validation
- Cap audioBase64 length BEFORE decode (5.4M chars / ~4MB)
- Non-string / malformed → {ok:false,error}
- Mime allowlist; filename sanitised+capped
- speakText: string check + hard max before trim
- client-secret: try/catch JSON + requires expires_at
- Tests: voice-input.test.ts (+ client-secret/stt); voice suite 63/63; tsc clean; build ok
