FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV MODELS_DIR=/data
VOLUME ["/data"]

EXPOSE 8610

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8610"]
