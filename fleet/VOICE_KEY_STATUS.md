Voice Key Status

- Status: CREATED
- Key name: adrians-mind-voice-realtime
- Key id: 1535cc0f-99ff-4e87-912a-4492c84ae274
- Scopes: voice, realtime, tts, stt
- Endpoint access: voice and the model list only. Chat, image, video, and files are not granted.
- Models: grok-tts, grok-voice-2.0, grok-voice-3.0, grok-voice-transcribe-2.0
- Rate: 2 per second, 30 per minute
- Stored at: /home/box/.secrets/XAI_VOICE_API_KEY (not in repo)
- Metadata at: /home/box/.secrets/XAI_VOICE_API_KEY.meta (not in repo)
- Redacted hint: xai-...tcnb
- Verification call: GET /v1/models — HTTP 200. The list was empty because chat models were not granted. Authorization succeeded.
- Created: 2026-11-05T09:48:36.750229Z
- Created by: Grok Build one-shot
- Management key: used in-session only, never written to disk
- Next step for Voice Stream bot: read XAI_VOICE_API_KEY from the secrets path and begin voice pipeline testing. No code changes needed from this task.
