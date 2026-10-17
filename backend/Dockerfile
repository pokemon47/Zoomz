# Zoomz API — FastAPI + Uvicorn. Runs database migrations on start.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# ffmpeg: video posters and web-friendly transcodes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN useradd --system --uid 10001 --user-group zoomz && mkdir -p /data/files && chown -R zoomz:zoomz /data /app
ENV APP_ENV=production STORAGE_DIR=/data/files
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
# Starts as root only to fix volume ownership, then drops to the zoomz user (see the script).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
