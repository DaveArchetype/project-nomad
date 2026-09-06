"""
Project NOMAD XTTS Voice Cloning service
=========================================

A GPU-accelerated FastAPI wrapper around Coqui XTTSv2
(https://github.com/coqui-ai/TTS), used for voice cloning from short audio
samples (6-30s). Cloned voices are stored as .wav files under SPEAKERS_DIR.
The XTTSv2 model (~1.8GB) is downloaded from HuggingFace on first use and
cached under MODELS_DIR.

This is an OPTIONAL Supply Depot service — install it from Supply Depot >
"Voice Cloning TTS" if you have a GPU. It complements the CPU-only Piper TTS
service, which remains the default.
"""

from __future__ import annotations

import io
import logging
import os
import re
import tempfile
import wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [xtts] %(message)s")
logger = logging.getLogger("xtts")

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/data"))
SPEAKERS_DIR = Path(os.environ.get("SPEAKERS_DIR", "/data/speakers"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SPEAKERS_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = os.environ.get("DEVICE", "cuda")
DEFAULT_LANGUAGE = os.environ.get("DEFAULT_LANGUAGE", "en")
MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "5000"))

app = FastAPI(title="Project NOMAD XTTS Voice Cloning")

_loaded_model = None
_model_loading = False


def _get_model():
    global _loaded_model, _model_loading
    if _loaded_model is not None:
        return _loaded_model
    if _model_loading:
        raise HTTPException(status_code=503, detail="Model is still loading. Please retry in a moment.")

    _model_loading = True
    try:
        import torch
        from TTS.api import TTS

        logger.info(f"Loading XTTSv2 model on device '{DEVICE}'...")
        tts = TTS(model_name="tts_models/multilingual/xtts_v2", gpu=(DEVICE.startswith("cuda")))
        _loaded_model = tts
        logger.info("XTTSv2 model loaded successfully.")
        return tts
    except Exception as exc:
        _model_loading = False
        logger.error(f"Failed to load XTTSv2 model: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to load XTTSv2 model: {exc}")
    finally:
        _model_loading = False


def _sanitize_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Voice name must contain at least one alphanumeric character.")
    return cleaned


def _speaker_path(name: str) -> Path:
    return SPEAKERS_DIR / f"{_sanitize_name(name)}.wav"


def _list_speakers() -> list[str]:
    speakers = []
    for p in SPEAKERS_DIR.glob("*.wav"):
        speakers.append(p.stem)
    for d in SPEAKERS_DIR.iterdir():
        if d.is_dir():
            wavs = list(d.glob("*.wav"))
            if wavs:
                speakers.append(d.name)
    return sorted(speakers)


def _get_speaker_wav(voice: str) -> str:
    name = _sanitize_name(voice)
    wav_file = SPEAKERS_DIR / f"{name}.wav"
    if wav_file.exists():
        return str(wav_file)
    speaker_dir = SPEAKERS_DIR / name
    if speaker_dir.is_dir():
        wavs = list(speaker_dir.glob("*.wav"))
        if wavs:
            return str(wavs[0])
    raise HTTPException(status_code=404, detail=f"Cloned voice '{voice}' not found.")


def _resample_to_wav(src_path: Path, dest_path: Path) -> None:
    import torchaudio

    waveform, sample_rate = torchaudio.load(str(src_path))
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 22050:
        resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=22050)
        waveform = resampler(waveform)
    torchaudio.save(str(dest_path), waveform, 22050, format="wav")


class SynthesizeRequest(BaseModel):
    text: str
    voice: str
    language: Optional[str] = None
    speed: Optional[float] = 1.0


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": _loaded_model is not None,
        "device": DEVICE,
        "speakers": len(_list_speakers()),
    }


@app.get("/voices")
async def list_voices():
    voices = _list_speakers()
    return {
        "voices": voices,
        "default": voices[0] if voices else None,
    }


@app.post("/voices/clone")
async def clone_voice(
    name: str = Form(...),
    file: UploadFile = File(...),
):
    clean_name = _sanitize_name(name)
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext not in (".wav", ".mp3", ".flac", ".ogg", ".m4a"):
        raise HTTPException(
            status_code=400,
            detail="Audio file must be .wav, .mp3, .flac, .ogg, or .m4a",
        )

    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    dest_wav = _speaker_path(clean_name)
    dest_wav.parent.mkdir(parents=True, exist_ok=True)

    if ext == ".wav":
        dest_wav.write_bytes(audio_data)
    else:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = Path(tmp.name)
        try:
            _resample_to_wav(tmp_path, dest_wav)
        finally:
            tmp_path.unlink(missing_ok=True)

    logger.info(f"Cloned voice '{clean_name}' saved to {dest_wav}")
    return {
        "success": True,
        "message": f"Voice '{clean_name}' cloned successfully.",
        "voice": clean_name,
    }


@app.delete("/voices/{voice}")
async def delete_voice(voice: str):
    name = _sanitize_name(voice)
    deleted = []

    wav_file = SPEAKERS_DIR / f"{name}.wav"
    if wav_file.exists():
        wav_file.unlink()
        deleted.append(wav_file.name)

    speaker_dir = SPEAKERS_DIR / name
    if speaker_dir.is_dir():
        import shutil
        shutil.rmtree(speaker_dir)
        deleted.append(speaker_dir.name)

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Cloned voice '{voice}' not found.")

    return {"success": True, "message": f"Voice '{voice}' deleted.", "voice": voice}


@app.get("/voices/{voice}/sample")
async def get_voice_sample(voice: str):
    wav_path = Path(_get_speaker_wav(voice))
    return FileResponse(str(wav_path), media_type="audio/wav")


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"text is too long (max {MAX_TEXT_LENGTH} chars).",
        )

    voice = req.voice
    if not voice:
        raise HTTPException(status_code=400, detail="voice is required.")

    speaker_wav = _get_speaker_wav(voice)
    language = req.language or DEFAULT_LANGUAGE
    speed = req.speed or 1.0
    speed = max(0.5, min(2.0, speed))

    model = _get_model()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        output_path = tmp.name

    try:
        model.tts_to_file(
            text=text,
            file_path=output_path,
            speaker_wav=speaker_wav,
            language=language,
            speed=speed,
        )
        with open(output_path, "rb") as f:
            audio_bytes = f.read()
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as exc:
        logger.error(f"XTTS synthesis failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {exc}")
    finally:
        Path(output_path).unlink(missing_ok=True)
