#!/bin/sh
set -e

DATA_DIR="${MODELS_DIR:-/data}"
SPEAKERS="${SPEAKERS_DIR:-/data/speakers}"

mkdir -p "$DATA_DIR" "$SPEAKERS"

exec uvicorn app:app --host 0.0.0.0 --port 8611
