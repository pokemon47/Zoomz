FROM node:24-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/opt/zoomz-browsers
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends nginx libstdc++6 \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home zoomz \
    && mkdir -p /data/uploads && chown zoomz:zoomz /data/uploads
COPY backend/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
RUN python -m playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /opt/zoomz-browsers \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=frontend /frontend/dist /app/public
COPY frontend/nginx.conf.template /app/deploy/server.conf.template
COPY deploy/nginx.conf deploy/start.sh /app/deploy/
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4)"]
ENTRYPOINT ["bash", "/app/deploy/start.sh"]
