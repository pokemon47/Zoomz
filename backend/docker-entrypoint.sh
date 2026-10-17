#!/bin/sh
# Volumes can mount owned by root; take ownership of the file store, then run unprivileged.
set -e
mkdir -p "${STORAGE_DIR:-/data/files}"
chown -R zoomz:zoomz "${STORAGE_DIR:-/data/files}" 2>/dev/null || true
exec setpriv --reuid=zoomz --regid=zoomz --init-groups sh -c "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"
