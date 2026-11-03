"""Pluggable backend slot — model-agnostic. Zack plugs Chatterbox / CosyVoice3 on his PC."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal


class VoiceCloneBackend(ABC):
    @abstractmethod
    def health(self) -> dict:
        """Must include ok/status, backend id, and watermark:{enabled,name,note}."""

    @abstractmethod
    def create_voice(self, *, voice_id: str, name: str, profile_id: str | None, audio: bytes, filename: str) -> str:
        """Register a reference sample; return provider voice_id."""

    @abstractmethod
    def delete_voice(self, voice_id: str) -> bool:
        ...

    @abstractmethod
    def tts(self, *, voice_id: str, text: str, format: Literal["wav", "mp3"] = "wav") -> tuple[bytes, str]:
        """Return (audio_bytes, mime)."""
