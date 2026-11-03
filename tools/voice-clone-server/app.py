"""
Adrian's Mind — local voice-clone HTTP contract (FastAPI).

Implements docs/voice-cloning/local-endpoint.md.

Backends (VOICE_CLONE_BACKEND):
  - chatterbox (default) — Resemble AI, MIT, PerTh watermark — weights on Zack's PC
  - cosyvoice3 — Fun-CosyVoice3-0.5B, Apache-2.0 — weights on Zack's PC
  - mock — deterministic tone for Studio e2e (mock-verified only)

DO NOT download Hugging Face weights from the agent box.
"""

from __future__ import annotations

import os
import uuid
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from backends.base import VoiceCloneBackend
from backends.chatterbox import ChatterboxBackend
from backends.cosyvoice3 import CosyVoice3Backend
from backends.mock import MockToneBackend

app = FastAPI(title="Adrian's Mind Voice Clone Local Engine", version="0.2.0")


def build_backend() -> VoiceCloneBackend:
    kind = (os.environ.get("VOICE_CLONE_BACKEND") or "chatterbox").strip().lower()
    if kind in ("mock", "mock-tone"):
        return MockToneBackend()
    if kind in ("chatterbox", "resemble", "perth"):
        return ChatterboxBackend()
    if kind in ("cosyvoice3", "cosyvoice", "fun-cosyvoice3"):
        return CosyVoice3Backend()
    raise RuntimeError(
        f"Unknown VOICE_CLONE_BACKEND={kind!r}. Use chatterbox | cosyvoice3 | mock."
    )


BACKEND: VoiceCloneBackend = build_backend()


class TtsRequest(BaseModel):
    voice_id: str = Field(min_length=2, max_length=128)
    text: str = Field(min_length=1, max_length=500)
    format: Literal["wav", "mp3"] = "wav"


@app.get("/health")
def health():
    # Always HTTP 200 with JSON so the Studio can read watermark + load_error even when weights are missing.
    body = BACKEND.health()
    return JSONResponse(body)


@app.post("/voices")
async def create_voice(
    file: UploadFile = File(...),
    name: str = Form("voice"),
    profile_id: str | None = Form(None),
    language: str = Form("en"),
):
    raw = await file.read()
    if len(raw) > 4_000_000:
        raise HTTPException(status_code=413, detail="audio too large")
    if len(raw) < 32:
        raise HTTPException(status_code=400, detail="audio too small")
    voice_id = f"loc_{uuid.uuid4().hex[:12]}"
    try:
        BACKEND.create_voice(
            voice_id=voice_id,
            name=(name or "voice")[:64],
            profile_id=profile_id,
            audio=raw,
            filename=file.filename or "sample.wav",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "voice_id": voice_id,
        "name": name,
        "language": language,
        "backend": BACKEND.health().get("backend"),
        "watermark": BACKEND.health().get("watermark"),
    }


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    ok = BACKEND.delete_voice(voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="voice not found")
    return {"ok": True, "deleted": True, "voice_id": voice_id}


@app.post("/tts")
def tts(body: TtsRequest):
    try:
        audio, mime = BACKEND.tts(voice_id=body.voice_id, text=body.text, format=body.format)
    except KeyError:
        raise HTTPException(status_code=404, detail="voice not found") from None
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if len(audio) > 2_000_000:
        raise HTTPException(status_code=500, detail="tts too large")
    return Response(content=audio, media_type=mime)
