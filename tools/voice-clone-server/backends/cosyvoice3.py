"""
Fun-CosyVoice3-0.5B backend slot — secondary pick.

Apache-2.0 code + weights. ~8 GB VRAM. Official FastAPI + save/delete speaker profiles.

HF: FunAudioLLM/Fun-CosyVoice3-0.5B-2512 (~9.7 GB).

THIS FILE DOES NOT DOWNLOAD OR LOAD WEIGHTS.
"""

from __future__ import annotations

from typing import Literal

from .base import VoiceCloneBackend


class CosyVoice3Backend(VoiceCloneBackend):
    def __init__(self) -> None:
        self._voices: dict[str, dict] = {}
        self._model = None
        self._load_error: str | None = None
        try:
            import importlib

            importlib.import_module("cosyvoice")  # type: ignore
            self._load_error = (
                "cosyvoice package importable, but scaffold does not auto-load weights. "
                "Prefer Fun-CosyVoice3 official FastAPI or wire add_zero_shot_spk here."
            )
        except Exception as exc:  # noqa: BLE001
            self._load_error = f"cosyvoice not installed yet ({type(exc).__name__}). See README."

    def health(self) -> dict:
        ready = self._model is not None
        return {
            "ok": True if ready else False,
            "status": "ready" if ready else "weights_not_loaded",
            "backend": "cosyvoice3",
            "repo": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
            "license": "Apache-2.0",
            "vram_gb_approx": 8,
            "download_gb_approx": 9.7,
            "weights_loaded": ready,
            "load_error": self._load_error,
            "watermark": {
                "enabled": False,
                "name": None,
                "note": "Fun-CosyVoice3 does not ship a built-in perceptual watermark like Chatterbox PerTh.",
            },
            "note": "Secondary pick. Official FastAPI + speaker profile save/delete. Install on Zack's PC only.",
        }

    def create_voice(self, *, voice_id: str, name: str, profile_id: str | None, audio: bytes, filename: str) -> str:
        if self._model is None:
            raise RuntimeError(
                "CosyVoice3 weights are not loaded. On Zack's PC download "
                "FunAudioLLM/Fun-CosyVoice3-0.5B-2512 (~9.7 GB) and wire add_zero_shot_spk / save_spkinfo."
            )
        if len(audio) < 32:
            raise ValueError("audio too small")
        self._voices[voice_id] = {"name": name, "profile_id": profile_id, "bytes": len(audio), "filename": filename}
        return voice_id

    def delete_voice(self, voice_id: str) -> bool:
        return self._voices.pop(voice_id, None) is not None

    def tts(self, *, voice_id: str, text: str, format: Literal["wav", "mp3"] = "wav") -> tuple[bytes, str]:
        if self._model is None:
            raise RuntimeError("CosyVoice3 weights are not loaded.")
        if voice_id not in self._voices:
            raise KeyError(voice_id)
        raise RuntimeError("CosyVoice3 inference not wired yet — plug inference after weights load on Zack's PC.")
