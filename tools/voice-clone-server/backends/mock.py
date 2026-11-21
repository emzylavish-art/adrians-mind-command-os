"""Deterministic mock backend for Studio e2e tests — NOT a real clone."""

from __future__ import annotations

import math
import struct
import zlib
from typing import Literal

from .base import VoiceCloneBackend


def _wav_tone(seconds: float = 0.25, freq: float = 440.0, rate: int = 16000) -> bytes:
    n = int(rate * seconds)
    frames = bytearray()
    for i in range(n):
        sample = int(16000 * math.sin(2 * math.pi * freq * (i / rate)))
        frames += struct.pack("<h", max(-32767, min(32767, sample)))
    data = bytes(frames)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        len(data),
    )
    return header + data


class MockToneBackend(VoiceCloneBackend):
    def __init__(self) -> None:
        self._voices: dict[str, dict] = {}

    def health(self) -> dict:
        return {
            "ok": True,
            "status": "ok",
            "backend": "mock-tone",
            "note": "mock-verified — not a real clone",
            "watermark": {
                "enabled": False,
                "name": None,
                "note": "Mock tone has no perceptual watermark.",
            },
            "weights_loaded": False,
        }

    def create_voice(self, *, voice_id: str, name: str, profile_id: str | None, audio: bytes, filename: str) -> str:
        if len(audio) < 8:
            raise ValueError("audio too small")
        self._voices[voice_id] = {"name": name, "profile_id": profile_id, "bytes": len(audio), "filename": filename}
        return voice_id

    def delete_voice(self, voice_id: str) -> bool:
        return self._voices.pop(voice_id, None) is not None

    def tts(self, *, voice_id: str, text: str, format: Literal["wav", "mp3"] = "wav") -> tuple[bytes, str]:
        if voice_id not in self._voices:
            raise KeyError(voice_id)
        digest = zlib.crc32(text.encode("utf-8")) & 0xFFFF
        freq = 220.0 + (digest % 500)
        wav = _wav_tone(0.3, freq)
        return wav, "audio/wav"
