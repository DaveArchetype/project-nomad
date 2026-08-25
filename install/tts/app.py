"""
Project NOMAD TTS service
==========================

A thin CPU-only FastAPI wrapper around Piper (https://github.com/rhasspy/piper),
used for (a) reading assistant chat replies aloud and (b) narrating the daily
ambient-recall recap. Voice models are small (~50-100MB) ONNX files fetched
on demand from the `rhasspy/piper-voices` Hugging Face repo and cached under
`MODELS_DIR`.
"""

from __future__ import annotations

import io
import json
import logging
import os
import wave
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [tts] %(message)s")
logger = logging.getLogger("tts")

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/data"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "en_US-lessac-medium")
VOICES_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

CURATED_VOICES = [
    "en_US-lessac-medium",
    "en_US-amy-medium",
    "en_GB-alan-medium",
]

app = FastAPI(title="Project NOMAD TTS")

_loaded_voices: dict[str, "PiperVoice"] = {}  # noqa: F821 - forward ref, imported lazily


def _voice_url_parts(voice: str) -> tuple[str, str]:
    """
    Parses e.g. "en_US-lessac-medium" into (onnx_url, config_url) under the
    piper-voices HF layout: {lang}/{lang_region}/{name}/{quality}/{file}.
    """
    try:
        lang_region, name, quality = voice.split("-")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid voice id: {voice}") from exc
    lang = lang_region.split("_")[0]
    base = f"{VOICES_BASE_URL}/{lang}/{lang_region}/{name}/{quality}/{voice}"
    return f"{base}.onnx", f"{base}.onnx.json"


def _ensure_voice_downloaded(voice: str) -> Path:
    onnx_path = MODELS_DIR / f"{voice}.onnx"
    json_path = MODELS_DIR / f"{voice}.onnx.json"
    if onnx_path.exists() and json_path.exists():
        return onnx_path

    onnx_url, config_url = _voice_url_parts(voice)
    logger.info(f"Downloading voice model {voice}...")
    with httpx.Client(follow_redirects=True, timeout=120.0) as client:
        for url, dest in ((onnx_url, onnx_path), (config_url, json_path)):
            resp = client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail=f"Voice '{voice}' not found upstream.")
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(resp.content)
            tmp.replace(dest)
    return onnx_path


def _get_voice(voice: str):
    if voice in _loaded_voices:
        return _loaded_voices[voice]

    from piper import PiperVoice

    onnx_path = _ensure_voice_downloaded(voice)
    loaded = PiperVoice.load(str(onnx_path))
    _loaded_voices[voice] = loaded
    return loaded


class SynthesizeRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/voices")
async def list_voices():
    downloaded = sorted(p.stem for p in MODELS_DIR.glob("*.onnx"))
    catalog = sorted(set(CURATED_VOICES) | set(downloaded))
    return {"voices": catalog, "downloaded": downloaded, "default": DEFAULT_VOICE}


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="text is too long (max 5000 chars).")

    voice_id = req.voice or DEFAULT_VOICE
    speed = req.speed or 1.0
    speed = max(0.5, min(2.0, speed))
    # Piper's length_scale is inverse of speed (>1 = slower).
    length_scale = 1.0 / speed

    voice = _get_voice(voice_id)

    # NOTE: matches piper-tts==1.2.0's documented `PiperVoice.synthesize(text, wav_file,
    # length_scale=...)` API (writes directly to an open `wave.Wave_write`). Verify against
    # the exact pinned version when first building this image — piper-tts's Python API has
    # changed across versions (some releases return raw PCM chunks from a generator instead).
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file, length_scale=length_scale)

    return Response(content=buffer.getvalue(), media_type="audio/wav")
