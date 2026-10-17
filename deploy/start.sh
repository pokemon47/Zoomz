#!/bin/bash
set -euo pipefail
# Create private, ephemeral nginx state as the existing non-root runtime user.
mkdir -p -m 700 /tmp/zoomz-nginx /tmp/zoomz-nginx/{client-body,proxy,fastcgi,uwsgi,scgi}
python -m app.preflight
alembic upgrade head
python - <<'PY'
import ipaddress, os, re
from pathlib import Path
cidr = os.environ.get('TRUSTED_PROXY_CIDR', '127.0.0.1/32')
ipaddress.ip_network(cidr, strict=False)
limit = os.environ.get('UPLOAD_BODY_LIMIT', '201m')
if not re.fullmatch(r'[1-9][0-9]*[mkMK]?', limit):
    raise SystemExit('UPLOAD_BODY_LIMIT must be a positive nginx size')
text = Path('/app/deploy/server.conf.template').read_text()
for name, value in {'TRUSTED_PROXY_CIDR': cidr, 'UPLOAD_BODY_LIMIT': limit, 'BACKEND_UPSTREAM': '127.0.0.1:8000'}.items():
    text = text.replace('${' + name + '}', value)
Path('/tmp/zoomz-nginx/server.conf').write_text(text.replace('/usr/share/nginx/html', '/app/public'))
PY
nginx -t -c /app/deploy/nginx.conf
# One worker: rooms and rate limits are process-local. Backend is loopback-only.
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 \
    --proxy-headers --forwarded-allow-ips=127.0.0.1 --no-access-log --ws-max-size 65536 &
api_pid=$!
nginx -c /app/deploy/nginx.conf -g 'daemon off;' &
web_pid=$!
stop() {
    trap - TERM INT EXIT
    kill -TERM "$api_pid" "$web_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
}
trap stop TERM INT EXIT
# Exit the container if either essential child exits, so the host can restart it.
set +e
wait -n "$api_pid" "$web_pid"
status=$?
set -e
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
