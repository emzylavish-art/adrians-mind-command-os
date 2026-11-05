# VOICE STREAM

Owns the speak path end-to-end. Uses Pipecat primary and whisper-loop for low latency. Goal: audio in, speech back, no intermediate write step. Instant barge-in. Sub-1-second target. Spawns STT probe, TTS probe, barge-in test, and phone-width network test sub-agents. Reads BOOT.md first.