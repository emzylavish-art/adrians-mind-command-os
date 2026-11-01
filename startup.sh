#!/bin/sh
cd "$(dirname "$0")"
INFERENCE_ENV="${XAI_INFERENCE_ENV_FILE:-/home/box/.secrets/xai_inference.env}"
if [ -f "$INFERENCE_ENV" ]; then
  # Drop a stale management key masquerading as XAI_API_KEY, then load inference.
  unset XAI_API_KEY
  # shellcheck disable=SC1090
  set -a
  # Prefer `.` over `source` for POSIX sh.
  . "$INFERENCE_ENV"
  set +a
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev > /tmp/mind-dev.log 2>&1 &
exit 0
