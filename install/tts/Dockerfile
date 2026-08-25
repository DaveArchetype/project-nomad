FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

RUN MODELS_DIR=/app/voices python -c "import os;os.environ['MODELS_DIR']='/app/voices';from pathlib import Path;Path('/app/voices').mkdir(parents=True,exist_ok=True);import importlib.util as u;s=u.spec_from_file_location('app','/app/app.py');m=u.module_from_spec(s);s.loader.exec_module(m);m._ensure_voice_downloaded('en_US-lessac-medium')"

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV MODELS_DIR=/data
VOLUME ["/data"]

EXPOSE 8610

CMD ["/usr/local/bin/entrypoint.sh"]
