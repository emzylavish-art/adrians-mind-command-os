# 02 VOICE STREAM

Owns the speak path end-to-end. Uses Pipecat primary, whisper-loop low-latency alternative. Goal: audio in, speech back, no intermediate write. Instant barge-in. Spawns sub-agents: STT probe, TTS probe, barge-in test, phone-width network test. Branch: fleet/voice-stream/pipeline.