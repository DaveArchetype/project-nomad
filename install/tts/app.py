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
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [tts] %(message)s")
logger = logging.getLogger("tts")

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/data"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "en_US-lessac-medium")
VOICES_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

VOICE_CATALOG = [
    # Arabic
    "ar_JO-kareem-low",
    "ar_JO-kareem-medium",
    # Catalan
    "ca_ES-upc_ona-x_low",
    "ca_ES-upc_ona-medium",
    "ca_ES-upc_pau-x_low",
    # Czech
    "cs_CZ-jirka-low",
    "cs_CZ-jirka-medium",
    # Welsh
    "cy_GB-bu_tts-medium",
    "cy_GB-gwryw_gogleddol-medium",
    # Danish
    "da_DK-talesyntese-medium",
    # German
    "de_DE-eva_k-x_low",
    "de_DE-karlsson-low",
    "de_DE-kerstin-low",
    "de_DE-mls-medium",
    "de_DE-pavoque-low",
    "de_DE-ramona-low",
    "de_DE-thorsten-low",
    "de_DE-thorsten-medium",
    "de_DE-thorsten-high",
    "de_DE-thorsten_emotional-medium",
    # Greek
    "el_GR-rapunzelina-low",
    # English (GB)
    "en_GB-alan-low",
    "en_GB-alan-medium",
    "en_GB-alba-medium",
    "en_GB-aru-medium",
    "en_GB-cori-medium",
    "en_GB-cori-high",
    "en_GB-jenny_dioco-medium",
    "en_GB-northern_english_male-medium",
    "en_GB-semaine-medium",
    "en_GB-southern_english_female-low",
    "en_GB-vctk-medium",
    # English (IE)
    "en_IE-nos-low",
    # English (US)
    "en_US-amy-low",
    "en_US-amy-medium",
    "en_US-arctic-medium",
    "en_US-bryce-medium",
    "en_US-danny-low",
    "en_US-hfc_female-medium",
    "en_US-hfc_male-medium",
    "en_US-joe-medium",
    "en_US-john-medium",
    "en_US-kathleen-low",
    "en_US-kristin-medium",
    "en_US-kusal-medium",
    "en_US-l2arctic-medium",
    "en_US-lessac-low",
    "en_US-lessac-medium",
    "en_US-lessac-high",
    "en_US-libritts-high",
    "en_US-libritts_r-medium",
    "en_US-ljspeech-medium",
    "en_US-ljspeech-high",
    "en_US-norman-medium",
    "en_US-reza_ibrahim-medium",
    "en_US-ryan-low",
    "en_US-ryan-medium",
    "en_US-ryan-high",
    "en_US-sam-medium",
    # English (ZA)
    "en_ZA-google-medium",
    # Spanish (AR)
    "es_AR-daniela-high",
    # Spanish (ES)
    "es_ES-carlfm-x_low",
    "es_ES-davefx-medium",
    "es_ES-mls_10246-low",
    "es_ES-mls_9972-low",
    "es_ES-sharvard-medium",
    # Spanish (MX)
    "es_MX-ald-medium",
    "es_MX-claude-high",
    # Farsi
    "fa_IR-amir-medium",
    "fa_IR-ganji-medium",
    "fa_IR-ganji_adabi-medium",
    "fa_IR-gyro-medium",
    "fa_IR-reza_ibrahim-medium",
    # Finnish
    "fi_FI-harri-low",
    "fi_FI-harri-medium",
    # French
    "fr_FR-gilles-low",
    "fr_FR-mls-medium",
    "fr_FR-mls_1840-low",
    "fr_FR-siwis-low",
    "fr_FR-siwis-medium",
    "fr_FR-tom-medium",
    "fr_FR-upmc-medium",
    # Hindi
    "hi_IN-pratham-medium",
    "hi_IN-priyamvada-medium",
    # Hungarian
    "hu_HU-anna-medium",
    "hu_HU-berta-medium",
    "hu_HU-imre-medium",
    # Icelandic
    "is_IS-bui-medium",
    "is_IS-salka-medium",
    "is_IS-steinn-medium",
    "is_IS-ugla-medium",
    # Italian
    "it_IT-paola-medium",
    "it_IT-riccardo-x_low",
    # Georgian
    "ka_GE-natia-medium",
    # Kazakh
    "kk_KZ-iseke-x_low",
    "kk_KZ-issai-high",
    "kk_KZ-raya-x_low",
    # Luxembourgish
    "lb_LU-marylux-medium",
    # Latvian
    "lv_LV-aivars-medium",
    # Malayalam
    "ml_IN-arjun-medium",
    "ml_IN-meera-medium",
    # Nepali
    "ne_NP-chitwan-medium",
    "ne_NP-google-x_low",
    "ne_NP-google-medium",
    # Dutch (BE)
    "nl_BE-nathaan-medium",
    "nl_BE-nathalie-x_low",
    "nl_BE-nathalie-medium",
    "nl_BE-rdh-x_low",
    "nl_BE-rdh-medium",
    # Dutch (NL)
    "nl_NL-mls-medium",
    "nl_NL-mls_5809-low",
    "nl_NL-mls_7432-low",
    "nl_NL-pim-medium",
    "nl_NL-ronnie-medium",
    # Norwegian
    "no_NO-talesyntese-medium",
    # Polish
    "pl_PL-darkman-medium",
    "pl_PL-gosia-medium",
    "pl_PL-mc_speech-medium",
    "pl_PL-mls_6892-low",
    # Portuguese (BR)
    "pt_BR-cadu-medium",
    "pt_BR-edresson-low",
    "pt_BR-faber-medium",
    "pt_BR-jeff-medium",
    # Portuguese (PT)
    "pt_PT-tugao-medium",
    # Romanian
    "ro_RO-mihai-medium",
    # Russian
    "ru_RU-denis-medium",
    "ru_RU-dmitri-medium",
    "ru_RU-irina-medium",
    "ru_RU-ruslan-medium",
    # Slovak
    "sk_SK-lili-medium",
    # Slovenian
    "sl_SI-artur-medium",
    # Serbian
    "sr_RS-serbski_institut-medium",
    # Swedish
    "sv_SE-lisa-medium",
    "sv_SE-nst-medium",
    # Swahili
    "sw_CD-lanfrica-medium",
    # Turkish
    "tr_TR-dfki-medium",
    "tr_TR-fahrettin-medium",
    "tr_TR-fettah-medium",
    # Ukrainian
    "uk_UA-lada-x_low",
    "uk_UA-ukrainian_tts-medium",
    # Vietnamese
    "vi_VN-25hours_single-low",
    "vi_VN-vais1000-medium",
    "vi_VN-vivos-x_low",
    # Chinese
    "zh_CN-huayan-x_low",
    "zh_CN-huayan-medium",
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
    downloaded = sorted(
        p.name.replace(".onnx", "")
        for p in MODELS_DIR.glob("*.onnx")
        if not p.name.endswith(".part")
    )
    catalog_set = set(VOICE_CATALOG)
    custom = sorted(v for v in downloaded if v not in catalog_set)
    return {
        "voices": sorted(VOICE_CATALOG),
        "downloaded": downloaded,
        "custom": custom,
        "default": DEFAULT_VOICE,
    }


class DownloadVoiceRequest(BaseModel):
    voice: str


@app.post("/voices/download")
async def download_voice(req: DownloadVoiceRequest):
    voice = req.voice.strip()
    if not voice:
        raise HTTPException(status_code=400, detail="voice must not be empty.")

    onnx_path = MODELS_DIR / f"{voice}.onnx"
    json_path = MODELS_DIR / f"{voice}.onnx.json"
    if onnx_path.exists() and json_path.exists():
        return {"success": True, "message": f"Voice '{voice}' is already downloaded.", "voice": voice}

    try:
        _ensure_voice_downloaded(voice)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Download failed: {exc}")

    return {"success": True, "message": f"Voice '{voice}' downloaded.", "voice": voice}


@app.delete("/voices/{voice}")
async def delete_voice(voice: str):
    if not voice:
        raise HTTPException(status_code=400, detail="voice must not be empty.")

    deleted_files = []
    for ext in (".onnx", ".onnx.json"):
        path = MODELS_DIR / f"{voice}{ext}"
        if path.exists():
            path.unlink()
            deleted_files.append(path.name)

    if voice in _loaded_voices:
        del _loaded_voices[voice]

    if not deleted_files:
        raise HTTPException(status_code=404, detail=f"Voice '{voice}' was not downloaded.")

    return {"success": True, "message": f"Voice '{voice}' deleted.", "voice": voice}


@app.post("/voices/upload")
async def upload_voice(onnx: UploadFile = File(...), config: UploadFile = File(...)):
    onnx_name = onnx.filename or ""
    config_name = config.filename or ""
    if not onnx_name.endswith(".onnx"):
        raise HTTPException(status_code=400, detail="onnx file must have a .onnx extension.")
    if not config_name.endswith(".json"):
        raise HTTPException(status_code=400, detail="config file must have a .json extension.")

    voice = onnx_name[:-5]
    onnx_path = MODELS_DIR / onnx_name
    json_path = MODELS_DIR / f"{voice}.onnx.json"
    if config_name != f"{voice}.onnx.json":
        json_path = MODELS_DIR / config_name

    onnx_data = await onnx.read()
    config_data = await config.read()
    if not onnx_data or not config_data:
        raise HTTPException(status_code=400, detail="Both files must not be empty.")

    onnx_path.write_bytes(onnx_data)
    json_path.write_bytes(config_data)

    if voice in _loaded_voices:
        del _loaded_voices[voice]

    return {"success": True, "message": f"Voice '{voice}' uploaded.", "voice": voice}


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
