"""
Project NOMAD Voice Gateway
============================

A single CPU-only FastAPI service that implements the "ambient listening"
pipeline described in the Voice Assistant feature:

    [raw PCM frames] -> VAD (webrtcvad) -> openWakeWord scoring
                                         -> faster-whisper transcription

Audio is streamed in over a WebSocket (`/ws/ingest`) as 16-bit mono PCM at
16kHz — the browser (or host-mic bridge) is responsible for resampling before
sending. The gateway never persists raw audio: as soon as an utterance is
transcribed, the PCM buffer for that utterance is discarded.

Messages sent back to the caller (JSON, one per line over the same socket):
    {"type": "wake", "score": 0.87, "model": "hey_jarvis"}
    {"type": "final", "text": "...", "startedAtMs": ..., "endedAtMs": ..., "isWakeWord": bool}
    {"type": "error", "message": "..."}

Configuration is passed via environment variables (mirrors the AI Settings >
Voice page in the admin UI, which calls this service indirectly through the
Adonis backend):
    WHISPER_MODEL_SIZE     tiny | base | small | medium         (default: base)
    WHISPER_LANGUAGE       BCP-47 code or "auto"                (default: auto)
    WAKE_WORD_PRESET       bundled openWakeWord model name      (default: hey_jarvis)
    WAKE_WORD_SENSITIVITY  0.0-1.0 detection threshold          (default: 0.5)
    VAD_SENSITIVITY        0-3 webrtcvad aggressiveness         (default: 2)
    MODELS_DIR             where model files/caches are stored  (default: /data)
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import webrtcvad
from fastapi import FastAPI, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [voice-gateway] %(message)s")
logger = logging.getLogger("voice-gateway")

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/data"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
CUSTOM_MODEL_PATH = MODELS_DIR / "custom_wakeword.onnx"

SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_BYTES = int(SAMPLE_RATE * FRAME_MS / 1000) * 2  # 16-bit samples
SILENCE_FRAMES_TO_END_UTTERANCE = 16  # ~480ms of trailing silence
MIN_SPEECH_FRAMES = 6  # ignore blips shorter than ~180ms
WAKE_EVENT_COOLDOWN_S = 2.0

BUILTIN_WAKE_WORD_PRESETS = [
    "alexa",
    "hey_jarvis",
    "hey_mycroft",
    "hey_rhasspy",
]

app = FastAPI(title="Project NOMAD Voice Gateway")

# ── Lazy-loaded, process-wide models (expensive to construct; shared across
# connections since neither openWakeWord's ONNX session nor faster-whisper's
# CTranslate2 model hold per-utterance state that isn't passed in explicitly).
_oww_model = None
_whisper_model = None


def _load_wakeword_model():
    global _oww_model
    from openwakeword.model import Model

    preset = os.environ.get("WAKE_WORD_PRESET", "hey_jarvis")
    wakeword_models = []
    if CUSTOM_MODEL_PATH.exists():
        wakeword_models.append(str(CUSTOM_MODEL_PATH))
        logger.info(f"Loading custom wake word model: {CUSTOM_MODEL_PATH}")
    else:
        wakeword_models.append(preset)
        logger.info(f"Loading bundled wake word preset: {preset}")

    _oww_model = Model(wakeword_models=wakeword_models, inference_framework="onnx")
    return _oww_model


def get_wakeword_model():
    global _oww_model
    if _oww_model is None:
        _oww_model = _load_wakeword_model()
    return _oww_model


def reload_wakeword_model():
    global _oww_model
    _oww_model = None
    return get_wakeword_model()


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        model_size = os.environ.get("WHISPER_MODEL_SIZE", "base")
        logger.info(f"Loading faster-whisper model: {model_size} (CPU, int8)")
        _whisper_model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",
            download_root=str(MODELS_DIR / "whisper"),
        )
    return _whisper_model


def pcm16_bytes_to_float32(raw: bytes) -> np.ndarray:
    ints = np.frombuffer(raw, dtype=np.int16)
    return ints.astype(np.float32) / 32768.0


class UtteranceSegmenter:
    """
    Per-connection state machine: buffers 30ms PCM frames, runs VAD + wake-word
    scoring on each, and accumulates contiguous speech into utterances that get
    flushed to faster-whisper once enough trailing silence is seen.
    """

    def __init__(self, vad_sensitivity: int, wake_threshold: float):
        self.vad = webrtcvad.Vad(max(0, min(3, vad_sensitivity)))
        self.wake_threshold = wake_threshold
        self.leftover = b""
        self.speech_frames: list[bytes] = []
        self.silence_run = 0
        self.utterance_started_at: Optional[float] = None
        self.last_wake_at = 0.0
        self.recent_wake = False

    def feed(self, chunk: bytes):
        """Yields (kind, payload) tuples for each completed frame's events."""
        self.leftover += chunk
        events = []
        while len(self.leftover) >= FRAME_BYTES:
            frame = self.leftover[:FRAME_BYTES]
            self.leftover = self.leftover[FRAME_BYTES:]
            events.extend(self._process_frame(frame))
        return events

    def _process_frame(self, frame: bytes):
        events = []
        try:
            is_speech = self.vad.is_speech(frame, SAMPLE_RATE)
        except Exception:
            is_speech = False

        # Wake-word scoring runs on every frame regardless of VAD state — the
        # phrase itself is what triggers speech in the first place.
        try:
            samples = np.frombuffer(frame, dtype=np.int16)
            predictions = get_wakeword_model().predict(samples)
            now = time.time()
            for model_name, score in predictions.items():
                if score >= self.wake_threshold and (now - self.last_wake_at) > WAKE_EVENT_COOLDOWN_S:
                    self.last_wake_at = now
                    self.recent_wake = True
                    events.append(("wake", {"score": float(score), "model": model_name}))
        except Exception as exc:  # pragma: no cover - defensive, model errors shouldn't kill the socket
            logger.warning(f"Wake word scoring failed: {exc}")

        if is_speech:
            if not self.speech_frames:
                self.utterance_started_at = time.time()
            self.speech_frames.append(frame)
            self.silence_run = 0
        elif self.speech_frames:
            self.silence_run += 1
            self.speech_frames.append(frame)  # keep a little trailing context
            if self.silence_run >= SILENCE_FRAMES_TO_END_UTTERANCE:
                finalized = self._flush_utterance()
                if finalized:
                    events.append(("final", finalized))

        return events

    def _flush_utterance(self):
        frames = self.speech_frames
        started_at = self.utterance_started_at
        was_wake = self.recent_wake
        self.speech_frames = []
        self.silence_run = 0
        self.recent_wake = False
        self.utterance_started_at = None

        if len(frames) < MIN_SPEECH_FRAMES or started_at is None:
            return None

        raw = b"".join(frames)
        audio = pcm16_bytes_to_float32(raw)
        ended_at = time.time()

        try:
            language = os.environ.get("WHISPER_LANGUAGE", "auto")
            kwargs = {} if language == "auto" else {"language": language}
            segments, _info = get_whisper_model().transcribe(audio, beam_size=1, vad_filter=False, **kwargs)
            text = " ".join(seg.text.strip() for seg in segments).strip()
        except Exception as exc:
            logger.error(f"Transcription failed: {exc}")
            return None

        if not text:
            return None

        return {
            "text": text,
            "startedAtMs": int(started_at * 1000),
            "endedAtMs": int(ended_at * 1000),
            "isWakeWord": was_wake,
        }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/wakeword-presets")
async def wakeword_presets():
    return {
        "presets": BUILTIN_WAKE_WORD_PRESETS,
        "hasCustomModel": CUSTOM_MODEL_PATH.exists(),
    }


@app.post("/wakeword-model")
async def upload_wakeword_model(file: UploadFile):
    """
    Accepts a custom-trained openWakeWord ONNX model (e.g. produced via the
    project's Colab training notebook) and makes it the active wake word.
    Only ONNX is accepted — openWakeWord's tflite runtime isn't installed here
    to keep the image CPU/x86-only and lean.
    """
    if not file.filename.lower().endswith(".onnx"):
        return JSONResponse(status_code=400, content={"error": "Only .onnx wake word models are supported."})

    contents = await file.read()
    tmp_path = MODELS_DIR / f".upload-{uuid.uuid4().hex}.onnx"
    tmp_path.write_bytes(contents)
    tmp_path.replace(CUSTOM_MODEL_PATH)

    try:
        reload_wakeword_model()
    except Exception as exc:
        CUSTOM_MODEL_PATH.unlink(missing_ok=True)
        reload_wakeword_model()
        return JSONResponse(status_code=400, content={"error": f"Model failed to load: {exc}"})

    return {"success": True, "message": "Custom wake word model installed."}


@app.delete("/wakeword-model")
async def delete_wakeword_model():
    CUSTOM_MODEL_PATH.unlink(missing_ok=True)
    reload_wakeword_model()
    return {"success": True, "message": "Reverted to the bundled wake word preset."}


@app.websocket("/ws/ingest")
async def ws_ingest(websocket: WebSocket):
    await websocket.accept()

    vad_sensitivity = int(os.environ.get("VAD_SENSITIVITY", "2"))
    wake_threshold = float(os.environ.get("WAKE_WORD_SENSITIVITY", "0.5"))
    segmenter = UtteranceSegmenter(vad_sensitivity, wake_threshold)

    # Warm up the models on first connection rather than at process start so
    # `/health` responds immediately even before any model has been loaded.
    await asyncio.get_event_loop().run_in_executor(None, get_wakeword_model)
    await asyncio.get_event_loop().run_in_executor(None, get_whisper_model)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            if "text" in message and message["text"] is not None:
                try:
                    control = json.loads(message["text"])
                    if control.get("type") == "config":
                        # Per-connection overrides (e.g. a different sensitivity for this
                        # session) could be applied here in the future; currently a no-op
                        # acknowledgement so the client knows the socket is ready.
                        await websocket.send_text(json.dumps({"type": "ready"}))
                except json.JSONDecodeError:
                    pass
                continue

            data = message.get("bytes")
            if not data:
                continue

            loop = asyncio.get_event_loop()
            events = await loop.run_in_executor(None, segmenter.feed, data)
            for kind, payload in events:
                await websocket.send_text(json.dumps({"type": kind, **payload}))
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:  # pragma: no cover
        logger.error(f"WS session error: {exc}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        except Exception:
            pass
