# Speak error contract

This file maps Speak failures onto the MCP call envelope in [docs/mcp-registry-contract.md](https://github.com/emzylavish-art/adrians-mind-command-os/blob/cursor/custom-connections-de4c/docs/mcp-registry-contract.md) from PR #30 (unmerged; the call shape was published in `src/lib/mind/mcp/call-contract.ts` at `0c98e2a`). It does not add banner components or mount snippets.

## Envelope

Speak results use the same three shapes as that contract:

- REST: `{ ok: false, error }`
- Call: `{ ok: false, status, text }` with HTTP 200 after the attempt has started. Sign-in stays HTTP 401. Cross-site stays HTTP 403.
- JSON-RPC application error: `{ error: { code, message } }`

`McpCallContract` fields used here: `ok`, `status`, `text`, `code` (`ok | error | unauthorized | missing_config | incompatible | ssrf_denied | timeout | disabled`), `transport` (`{ ok, status, ms }` or `null` when the call never left the process), and `rpc` (`{ isError, content, structuredContent }` or `null` when there was no JSON-RPC result).

A failure is keyed off `ok === false`, `transport.ok === false`, or `rpc.isError === true`. A numeric HTTP status is not the key. `transport.ok` is false for timeouts and unreachable hosts, and `rpc` is null in those cases. A JSON-RPC error or `rpc.isError: true` keeps `transport.ok` true when the HTTP status is 2xx. That is an application error. Retry only when `transport.ok` is false or `code` is `timeout`. Do not retry because `rpc.isError` is true.

Messages are sanitized before they are stored: bearer tokens, key-shaped strings, and raw JSON bodies are removed. Each Speak attempt has its own `correlationId` on `snapshotSpeakRetryParams`. A new press mints a new id. Dismiss or a newer press clears the previous error. A late result from an older generation is dropped.

## Kind gap

`classifySpeakFailure` returns `{ kind: HonestFailureKind; message }` using only kinds already declared in `src/lib/mind/failure-states.ts`. That file was not changed. These Speak cases have no dedicated kind:

| Speak case | Returned kind | Message source |
| --- | --- | --- |
| Signed out, or the session expired | `auth_required` | `VOICE_SIGN_IN_REQUIRED` in `src/lib/mind/voice/errors.ts` |
| No speech key | `model_unavailable` | `HONEST_FAILURE_MESSAGES.model_unconfigured`, plus the speech-key sentence |
| Network, microphone permission, missing microphone, blocked playback | `network_failure` | `VOICE_CONNECTION_DROPPED`, `VOICE_MIC_DENIED`, `VOICE_MIC_MISSING`, or "The browser blocked playback." |
| Session or provider timeout | `chat_timeout` | `CHAT_TIMEOUT_REPLY` when the text does not already say it timed out |
| Emergency stop | `emergency_stop_active` | existing emergency-stop copy |
| Rate limit | `rate_limited` | existing rate-limit copy |

Microphone permission, a missing microphone, and blocked playback are the gap: they are bucketed as `network_failure` so Error Banners can render them without a new kind. `classifyHonestFailure` on those voice sentences returns null, because the markers in `failure-states.ts` do not list them. Callers should use the `kind` returned by `classifySpeakFailure`, not re-classify the sentence.

## Retry of a finished turn

`runSpeakAction` and `pressSpeak` (`src/lib/mind/voice/speak-click.ts`, called from `speak()` in `src/components/mind/command-app.tsx`) share one rule. If the transcript was already sent, or the reply is already stored, retry synthesizes and plays that same reply, or it no-ops when there is no reply. It does not call the chat turn again. `onceRetry` from `src/lib/mind/retry-fidelity.ts` is re-exported from `src/lib/mind/voice/speak-action.ts`.

## Getting session

`withSessionTimeout` rejects after 10 seconds when the session mint does not settle. The visible control `data-testid="composer-voice-live"` leaves "Getting session…" and shows the timeout sentence with Retry. The bottom nav `nav[aria-label=Primary]` is stacked under that control at narrow widths so it does not take the click.
