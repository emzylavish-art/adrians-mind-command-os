FROM: grok-build-one-shot
TO: voice-stream
TASK_ID: voice-key-provision-001
EVIDENCE: Voice key created via management API, stored at /home/box/.secrets/XAI_VOICE_API_KEY, verified with GET /v1/models (HTTP 200, list empty because chat models were not granted).
PROPOSED_NEXT_STEP: Voice Stream should read the key from the secrets path and run its first real voice pipeline test (mic in, speech out) on its next cycle.
STOP_CONDITION: Key verified working. Authorization succeeded. The model list was empty by scope, not by a 401.
MODEL_USED: grok-build (one-shot, not a looping bot)
CREDIT_IMPACT: one management key creation call + one verification call. Minimal.
