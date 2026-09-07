"""
Project NOMAD Pocket TTS voice cloning service
==============================================

A CPU-first FastAPI wrapper around Kyutai Pocket TTS. The model and prepared
voice states remain in memory, while model files, source recordings, and
safetensors voice states persist under /data.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import tempfile
import threading
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
import scipy.io.wavfile
import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [pocket-tts] %(message)s")
logger = logging.getLogger("pocket-tts")

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/data"))
HF_HOME = Path(os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf_cache")))
SPEAKERS_DIR = Path(os.environ.get("SPEAKERS_DIR", "/data/speakers"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
HF_HOME.mkdir(parents=True, exist_ok=True)
SPEAKERS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_LANGUAGE = os.environ.get("DEFAULT_LANGUAGE", "en")
MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "5000"))
LANGUAGE_MODELS = {
    "en": "english",
    "fr": "french_24l",
    "de": "german_24l",
    "pt": "portuguese_24l",
    "it": "italian_24l",
    "es": "spanish_24l",
}

_models = {}
_voice_states = {}
_model_lock = threading.Lock()
_inference_lock = asyncio.Lock()


def _sanitize_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Voice name must contain an alphanumeric character.")
    return cleaned


def _normalize_language(language: Optional[str]) -> str:
    normalized = (language or DEFAULT_LANGUAGE).lower()
    if normalized not in LANGUAGE_MODELS:
        supported = ", ".join(sorted(LANGUAGE_MODELS))
        raise HTTPException(status_code=400, detail=f"Unsupported language '{normalized}'. Supported: {supported}.")
    return normalized


def _speaker_path(name: str) -> Path:
    return SPEAKERS_DIR / f"{_sanitize_name(name)}.wav"


def _embedding_path(name: str, language: str) -> Path:
    return SPEAKERS_DIR / f"{_sanitize_name(name)}.{language}.safetensors"


def _list_speakers() -> list[str]:
    speakers = {path.stem for path in SPEAKERS_DIR.glob("*.wav")}
    for path in SPEAKERS_DIR.iterdir():
        if path.is_dir() and any(path.glob("*.wav")):
            speakers.add(path.name)
    return sorted(speakers)


def _get_speaker_wav(voice: str) -> Path:
    name = _sanitize_name(voice)
    wav_file = SPEAKERS_DIR / f"{name}.wav"
    if wav_file.exists():
        return wav_file
    speaker_dir = SPEAKERS_DIR / name
    if speaker_dir.is_dir():
        wavs = list(speaker_dir.glob("*.wav"))
        if wavs:
            return wavs[0]
    raise HTTPException(status_code=404, detail=f"Cloned voice '{voice}' not found.")


def _get_model(language: str):
    with _model_lock:
        model = _models.get(language)
        if model is not None:
            return model
        from pocket_tts import TTSModel

        model_name = LANGUAGE_MODELS[language]
        logger.info(f"Loading Pocket TTS model '{model_name}' on CPU...")
        model = TTSModel.load_model(language=model_name)
        _models[language] = model
        logger.info(f"Pocket TTS model '{model_name}' loaded successfully.")
        return model


def _get_voice_state(model, voice: str, language: str, rebuild: bool = False):
    from pocket_tts import export_model_state

    name = _sanitize_name(voice)
    cache_key = (language, name)
    if rebuild:
        _voice_states.pop(cache_key, None)
    cached = _voice_states.get(cache_key)
    if cached is not None:
        return cached

    embedding_path = _embedding_path(name, language)
    if embedding_path.exists() and not rebuild:
        try:
            state = model.get_state_for_audio_prompt(embedding_path)
            _voice_states[cache_key] = state
            return state
        except Exception as exc:
            logger.warning(f"Rebuilding voice state '{name}' for '{language}': {exc}")

    state = model.get_state_for_audio_prompt(_get_speaker_wav(name), truncate=True)
    with tempfile.NamedTemporaryFile(
        suffix=".safetensors", dir=SPEAKERS_DIR, delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        export_model_state(state, temporary_path)
        os.replace(temporary_path, embedding_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    _voice_states[cache_key] = state
    return state


def _warm_default_model():
    language = _normalize_language(DEFAULT_LANGUAGE)
    model = _get_model(language)
    for voice in _list_speakers():
        try:
            _normalize_existing_voice(voice)
            _get_voice_state(model, voice, language)
        except Exception as exc:
            logger.warning(f"Failed to prepare voice '{voice}': {exc}")


async def _run_locked(function, *args):
    async with _inference_lock:
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(_warm_default_model)
    yield


app = FastAPI(title="Project NOMAD Pocket TTS Voice Cloning", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str
    voice: str
    language: Optional[str] = None
    speed: Optional[float] = 1.0


@app.get("/health")
async def health():
    default_language = _normalize_language(DEFAULT_LANGUAGE)
    return {
        "status": "ok",
        "engine": "pocket-tts",
        "model_loaded": default_language in _models,
        "loaded_languages": sorted(_models),
        "device": "cpu",
        "speakers": len(_list_speakers()),
    }


@app.get("/voices")
async def list_voices():
    voices = _list_speakers()
    return {"voices": voices, "default": voices[0] if voices else None}


def _resample_to_wav(src_path: Path, dest_path: Path):
    waveform, sample_rate = torchaudio.load(str(src_path))
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 24000:
        waveform = torchaudio.transforms.Resample(sample_rate, 24000)(waveform)
    pcm = (waveform.clamp(-1.0, 1.0) * 32767.0).round().to(torch.int16)
    torchaudio.save(str(dest_path), pcm, 24000)


def _normalize_existing_voice(voice: str):
    source = _get_speaker_wav(voice)
    metadata = torchaudio.info(str(source))
    if metadata.sample_rate == 24000 and metadata.num_channels == 1 and metadata.bits_per_sample == 16:
        return
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=source.parent, delete=False) as output:
        output_path = Path(output.name)
    try:
        _resample_to_wav(source, output_path)
        os.replace(output_path, source)
    finally:
        output_path.unlink(missing_ok=True)


def _store_voice(audio_data: bytes, extension: str, destination: Path):
    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as source:
        source.write(audio_data)
        source_path = Path(source.name)
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=SPEAKERS_DIR, delete=False) as output:
        output_path = Path(output.name)
    try:
        _resample_to_wav(source_path, output_path)
        os.replace(output_path, destination)
    finally:
        source_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)


def _prepare_voice(voice: str, language: str):
    name = _sanitize_name(voice)
    for key in [key for key in _voice_states if key[1] == name]:
        _voice_states.pop(key, None)
    for path in SPEAKERS_DIR.glob(f"{name}.*.safetensors"):
        path.unlink(missing_ok=True)
    model = _get_model(language)
    _get_voice_state(model, name, language, rebuild=True)


def _clone_and_prepare_voice(
    audio_data: bytes, extension: str, destination: Path, voice: str, language: str
):
    _store_voice(audio_data, extension, destination)
    _prepare_voice(voice, language)


@app.post("/voices/clone")
async def clone_voice(name: str = Form(...), file: UploadFile = File(...)):
    clean_name = _sanitize_name(name)
    extension = Path(file.filename or "").suffix.lower()
    if extension not in (".wav", ".mp3", ".flac", ".ogg", ".m4a"):
        raise HTTPException(status_code=400, detail="Audio must be WAV, MP3, FLAC, OGG, or M4A.")
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    destination = _speaker_path(clean_name)
    language = _normalize_language(DEFAULT_LANGUAGE)
    await _run_locked(
        _clone_and_prepare_voice,
        audio_data,
        extension,
        destination,
        clean_name,
        language,
    )
    logger.info(f"Cloned voice '{clean_name}' prepared for Pocket TTS.")
    return {
        "success": True,
        "message": f"Voice '{clean_name}' cloned successfully.",
        "voice": clean_name,
    }


def _delete_voice(voice: str) -> bool:
    name = _sanitize_name(voice)
    deleted = False
    wav_file = SPEAKERS_DIR / f"{name}.wav"
    if wav_file.exists():
        wav_file.unlink()
        deleted = True
    for embedding in SPEAKERS_DIR.glob(f"{name}.*.safetensors"):
        embedding.unlink()
        deleted = True
    speaker_dir = SPEAKERS_DIR / name
    if speaker_dir.is_dir():
        shutil.rmtree(speaker_dir)
        deleted = True
    for key in [key for key in _voice_states if key[1] == name]:
        _voice_states.pop(key, None)
    return deleted


@app.delete("/voices/{voice}")
async def delete_voice(voice: str):
    if not await _run_locked(_delete_voice, voice):
        raise HTTPException(status_code=404, detail=f"Cloned voice '{voice}' not found.")
    return {"success": True, "message": f"Voice '{voice}' deleted.", "voice": voice}


@app.get("/voices/{voice}/sample")
async def get_voice_sample(voice: str):
    return FileResponse(str(_get_speaker_wav(voice)), media_type="audio/wav")


def _synthesize_audio(model, voice: str, language: str, text: str) -> bytes:
    state = _get_voice_state(model, voice, language)
    audio = model.generate_audio(state, text, copy_state=True)
    samples = audio.detach().cpu().numpy().squeeze()
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16)
    output = BytesIO()
    scipy.io.wavfile.write(output, model.sample_rate, pcm)
    return output.getvalue()


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"text is too long (max {MAX_TEXT_LENGTH} chars).")
    if not req.voice:
        raise HTTPException(status_code=400, detail="voice is required.")

    language = _normalize_language(req.language)
    model = await asyncio.to_thread(_get_model, language)
    try:
        audio_bytes = await _run_locked(_synthesize_audio, model, req.voice, language, text)
        return Response(content=audio_bytes, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Pocket TTS synthesis failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {exc}")
