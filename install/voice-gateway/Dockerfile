FROM python:3.11-slim

# libsndfile/ffmpeg are runtime deps of faster-whisper's audio decode path;
# build-essential is needed for a couple of the onnxruntime/openwakeword
# transitive wheels that don't ship manylinux binaries for every platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch the bundled wake word preset models at build time so a fresh
# container doesn't stall on first connection downloading them.
RUN python -c "from openwakeword.model import Model; Model(wakeword_models=['hey_jarvis'], inference_framework='onnx')" || true

COPY app.py .

ENV MODELS_DIR=/data
VOLUME ["/data"]

EXPOSE 8600

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8600"]
