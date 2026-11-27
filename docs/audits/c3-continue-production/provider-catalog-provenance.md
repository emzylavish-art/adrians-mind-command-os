# AA191 provider catalogue provenance and verification limits

These public official references were read on 2026-11-26 to validate request endpoints and response shapes. No authenticated model-list, inference, paid generation or owner account request was made. Source documents establish API contracts, not successful execution in the owner's account.

| Provider | Official source | Implemented metadata contract |
|---|---|---|
| xAI | https://docs.x.ai/developers/rest-api-reference/inference/models | `GET /v1/language-models`; complete `models` list, IDs, aliases and input modalities. This endpoint deliberately excludes image/video generation catalogues from chat model selection. |
| OpenAI | https://developers.openai.com/api/reference/resources/models/methods/list | `GET /v1/models`, model IDs in `data`. Catalogue membership is separate from successful chat inference and does not itself declare image support. |
| Gemini | https://aistudio.google.com/api-reference/models/list-models | `GET /v1beta/models`; `pageSize` up to1000, `pageToken` and returned `nextPageToken`. Preserve resource IDs, `supportedGenerationMethods`, `inputTokenLimit` and `outputTokenLimit`; exclude explicitly non-generateContent models. |
| Anthropic | https://platform.claude.com/docs/en/api/models/list | `GET /v1/models`; `limit` up to1000, `after_id`, `has_more` and `last_id`. Retain declared `max_input_tokens` and `max_tokens`; omit explicitly retired records. |
| OpenRouter | https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties | `GET /api/v1/models`; `data`, architecture input modalities, total context and top-provider completion limit. This is a model catalogue, not proof of account credit, per-user policy, free pricing or inference success. Existing explicit free-routing and monetary gates remain separate. |
| Ollama | https://docs.ollama.com/api/tags | `GET /api/tags` only for the configured native `/api/generate` origin; `models[].name`. Legacy custom runner endpoints are not probed. |

## Deliberate implementation limits

- Discovery occurs only on the owner's explicit Refresh models action and issues metadata GET requests. It never spends a generation reservation, invokes inference, follows redirects, repeats an error automatically or chooses an alternative model.
- Discovery is bounded to eight pages,4000 normalized entries and8MB per response. Incomplete pagination, malformed entries and errors produce an unavailable snapshot rather than a truncated catalogue incorrectly proving a model absent.
- Public readiness distinguishes unconfigured, unverified, catalogued, unavailable and stale. `inferenceVerified` remains false. The snapshot expires after24 hours, and changed credentials/endpoints invalidate the previous evidence by fingerprint.
- Before any observation, existing configured requests remain explicitly unverified. Once a catalogue is observed, missing, stale or failed evidence blocks the exact selected request until the owner refreshes or chooses another model. Auto keeps its resolved tier and rejects it if unavailable; it does not search for a potentially more expensive substitute.
- Database-only UI refresh on focus/visibility does not call a provider. Server validation re-reads current owner/credential evidence before helper spending and again before the actual dispatch reservation.
- Provider-advertised capability metadata, known adapter profiles, unknown capabilities and successful inference receipts remain separate. Unknown fields are not promoted to supported.

## Executed verification

`catalogue-final-targeted.log`:75 passed,0 failed. This includes disappearance while another candidate remains available, Auto refusing its missing resolved tier, modality/output-cap changes, owner/key isolation, expiry, failed and incomplete discovery, Gemini/Anthropic pagination, native Ollama origin binding, retained selections, mounted ordering and existing provider/model/migration regressions.

`catalogue-fixture-final.log`:9 passed,0 failed after replacing six unreachable test failure-message accesses that TypeScript narrowed to `never`. Parent owns final whole-repository tests, TypeScript, build and visual evidence. No fixture is represented as live-provider proof.
