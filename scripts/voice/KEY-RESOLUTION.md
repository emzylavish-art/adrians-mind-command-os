# Voice lane key resolution vs xai-verification

## What xai-verification added (`2fa69f4`)

`resolveXaiInferenceApiKey` in `src/lib/mind/xai-adapter.ts` on branch
`xai-verification`. It:

- loads `/home/box/.secrets/xai_inference.env` (or `XAI_INFERENCE_SECRETS_PATH`)
- prefers the secrets-file inference key over a process env that equals
  `XAI_MANAGEMENT_KEY`
- is used for **typed chat / agent / models** paths (`XAI_API_KEY`)

That file **does not exist on `voice-wiring`**. Importing it would require
merging or cherry-picking `xai-adapter.ts` and related startup/`with-app-env`
changes from `xai-verification` — out of lane and would touch shared chat code.

## Why voice does not call that helper

Voice mint uses **`XAI_VOICE_API_KEY`** (scoped speech key) via
`resolveVoiceApiKey` in `src/lib/mind/voice/keys.ts` (Voice Integration owned;
wrap-only). That is a different secret from the chat inference key.

Adopting `resolveXaiInferenceApiKey` wholesale for voice mint would either:

1. pull the chat inference key into realtime mint (wrong ACL surface), or
2. require editing `src/lib/mind/voice/` (disallowed for this lane).

## What voice-wiring does instead

- `scripts/voice/dev-preview.sh` sources inference + voice secret files, unsets
  a stale `XAI_API_KEY`, refuses start when `XAI_API_KEY == XAI_MANAGEMENT_KEY`,
  and never prints key material (only lengths).
- Live mint goes through `createVoiceClientSecret` → `resolveVoiceApiKey`.
- Round-trip scripts load the voice secrets file the same way without echoing.

After `xai-verification` merges to main, a follow-up can mirror the
secrets-file-override pattern for voice keys **inside Voice Integration**
(`voice/keys.ts`) without changing the speech-vs-chat key split.
