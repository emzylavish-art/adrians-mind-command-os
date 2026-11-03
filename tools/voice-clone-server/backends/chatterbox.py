"""
Chatterbox (Resemble AI) backend slot — DEFAULT real backend for Zack's PC.

MIT code + weights. ~4 GB VRAM. Zero-shot from ~5–10 s. Built-in PerTh watermark.

THIS FILE DOES NOT DOWNLOAD OR LOAD WEIGHTS. On first real run on Zack's PC it will
import `chatterbox` / torch only if installed. Until then health reports weights_loaded=false.

HF: ResembleAI/chatterbox (~3.2 GB practical download).
"""

from __future__ import annotations

from typing import Literal

from .base import VoiceCloneBackend


class ChatterboxBackend(VoiceCloneBackend):
    """Thin wrapper slot. Real inference is implemented when packages exist on Zack's PC."""

    def __init__(self) -> None:
        self._voices: dict[str, dict] = {}
        self._model = None
        self._load_error: str | None = None
        # Intentionally do NOT auto-download. Zack pulls weights on his machine.
        try:
            # Optional local import — never pip-install from the agent box.
            import importlib

            importlib.import_module("chatterbox")  # type: ignore
            self._load_error = (
                "chatterbox package is importable, but this scaffold does not auto-load "
                "weights. Wire model.load() here after Zack downloads ResembleAI/chatterbox."
            )
        except Exception as exc:  # noqa: BLE001 — report honestly
            self._load_error = f"chatterbox not installed yet ({type(exc).__name__}). See README."

    def health(self) -> dict:
        ready = self._model is not None
        return {
            "ok": True if ready else False,
            "status": "ready" if ready else "weights_not_loaded",
            "backend": "chatterbox",
            "repo": "ResembleAI/chatterbox",
            "license": "MIT",
            "vram_gb_approx": 4,
            "download_gb_approx": 3.2,
            "weights_loaded": ready,
            "load_error": self._load_error,
            "watermark": {
                "enabled": True,
                "name": "PerTh",
                "note": "Chatterbox embeds Resemble PerTh perceptual watermark on synthesized audio.",
            },
            "note": "Primary pick for Adrian's Mind. Install on Zack's PC only — do not download on the agent box.",
        }

    def create_voice(self, *, voice_id: str, name: str, profile_id: str | None, audio: bytes, filename: str) -> str:
        if self._model is None:
            raise RuntimeError(
                "Chatterbox weights are not loaded. On Zack's PC: pip install chatterbox-tts (or project package), "
                "download ResembleAI/chatterbox (~3.2 GB), then wire load() in this backend."
            )
        if len(audio) < 32:
            raise ValueError("audio too small")
        self._voices[voice_id] = {"name": name, "profile_id": profile_id, "bytes": len(audio), "filename": filename, "ref": audio}
        return voice_id

    def delete_voice(self, voice_id: str) -> bool:
        return self._voices.pop(voice_id, None) is not None

    def tts(self, *, voice_id: str, text: str, format: Literal["wav", "mp3"] = "wav") -> tuple[bytes, str]:
        if self._model is None:
            raise RuntimeError("Chatterbox weights are not loaded.")
        if voice_id not in self._voices:
            raise KeyError(voice_id)
        raise RuntimeError("Chatterbox inference not wired yet — plug generate() after weights load on Zack's PC.")
