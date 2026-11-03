# Local voice-clone HTTP contract (Adrian's Mind)

> Engines behind this contract are reached **only** via the Voice Connection Hub adapters (`chatterbox-local`, `cosyvoice3-local`, `generic-http`). Studio does not call this URL directly in the default configuration.


Model-agnostic API for the Voice Cloning Studio local engine running on Zack's PC.

Base URL: `VOICE_CLONE_LOCAL_URL` (default `http://127.0.0.1:7860`).

Reference scaffold: `tools/voice-clone-server/`.

## Endpoints

### `GET /health`

Returns engine readiness.

**200** `application/json`:

```json
{ "ok": true, "status": "ok", "backend": "mock-tone" }
```

Studio treats `ok: true` or `status` in `ok` | `ready` as healthy. Anything else → banner **"Local voice engine not running"**.

### `POST /voices`

Create / register a cloned voice from a reference sample.

`multipart/form-data`:

| Field | Required | Description |
| --- | --- | --- |
| `file` | yes | Reference audio (wav/webm/ogg/mp3/m4a), max ~4 MiB |
| `name` | no | Display name |
| `profile_id` | no | Studio profile id |
| `language` | no | BCP-47 / ISO 639, default `en` |

**200** `application/json`:

```json
{ "voice_id": "loc_ab12cd34ef56", "name": "Home Voice" }
```

(`id` is accepted as an alias of `voice_id`.)

### `POST /tts`

Synthesize speech with a registered voice.

**JSON body:**

```json
{ "voice_id": "loc_ab12cd34ef56", "text": "Hello from Adrian's Mind.", "format": "wav" }
```

`format`: `wav` | `mp3`.

**200** raw audio bytes with `Content-Type: audio/wav` or `audio/mpeg`. Max ~2 MiB.

### `DELETE /voices/{voice_id}`

Remove the provider-side voice.

**200** `{ "ok": true, "deleted": true }` or **404** if already gone.

## OpenAPI (sketch)

```yaml
openapi: 3.0.3
info:
  title: Adrian's Mind Local Voice Clone Engine
  version: 0.1.0
paths:
  /health:
    get:
      responses:
        "200":
          description: Engine health
  /voices:
    post:
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
                name: { type: string }
                profile_id: { type: string }
                language: { type: string }
      responses:
        "200":
          description: Created voice
  /tts:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [voice_id, text]
              properties:
                voice_id: { type: string }
                text: { type: string, maxLength: 500 }
                format: { type: string, enum: [wav, mp3] }
      responses:
        "200":
          description: Audio bytes
  /voices/{voice_id}:
    delete:
      parameters:
        - in: path
          name: voice_id
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Deleted
```

## Security

- Default allowlist: loopback only (`127.0.0.1`, `localhost`, `::1`).
- Override: `VOICE_CLONE_ALLOW_REMOTE=1` (discouraged).
- No API keys are required for the local mock; real backends may add auth later.

## Mock vs real

| Mode | Meaning |
| --- | --- |
| **mock-verified** | `VOICE_CLONE_BACKEND=mock` returns a deterministic tone. Proves Studio consent → create → TTS → export → delete. **Not a real clone.** |
| **real clone (pending)** | Zack installs Qwen + the open-source cloner on his PC and swaps the backend slot. |
