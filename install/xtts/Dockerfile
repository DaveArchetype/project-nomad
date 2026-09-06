FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ffmpeg libgomp1 libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV MODELS_DIR=/data
ENV TTS_HOME=/data/models
ENV HF_HOME=/data/hf_cache
ENV SPEAKERS_DIR=/data/speakers
ENV DEVICE=cpu
ENV COQUI_TOS_AGREED=1
ENV DEFAULT_LANGUAGE=en
ENV MAX_TEXT_LENGTH=5000

VOLUME ["/data"]

EXPOSE 8611

CMD ["/usr/local/bin/entrypoint.sh"]
