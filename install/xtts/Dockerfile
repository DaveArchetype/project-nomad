FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ffmpeg libgomp1 libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV MODELS_DIR=/data
ENV HF_HOME=/data/hf_cache
ENV SPEAKERS_DIR=/data/speakers
ENV DEFAULT_LANGUAGE=en
ENV MAX_TEXT_LENGTH=5000

VOLUME ["/data"]

EXPOSE 8611

CMD ["/usr/local/bin/entrypoint.sh"]
