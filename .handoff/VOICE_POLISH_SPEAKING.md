Voice polish after H11 (Africa/Lagos)
1) Speaking held until SharedAudioOutput playback ends (not response.done / TTS HTTP return).
2) Interrupt button only while phase===speaking (hidden after interrupt).
3) Voice-mode transcripts route to chat turns; composer draft cleared (dictation still inserts).
Tests: speaking-playback, transcript-routing; voice suite 66/66; tsc+build clean.
