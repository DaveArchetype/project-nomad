#!/bin/sh
set -e

BUNDLED_DIR="/app/voices"
DATA_DIR="${MODELS_DIR:-/data}"

mkdir -p "$DATA_DIR"

for f in "$BUNDLED_DIR"/*.onnx "$BUNDLED_DIR"/*.onnx.json; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    if [ ! -e "$DATA_DIR/$base" ]; then
        cp "$f" "$DATA_DIR/$base"
    fi
done

exec uvicorn app:app --host 0.0.0.0 --port 8610
