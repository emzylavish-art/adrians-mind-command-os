#!/usr/bin/env bash
# Relaunch voice preview on :8095 if it exits (OOM kill / crash). Does not touch other ports.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PORT="${VOICE_PREVIEW_PORT:-8095}"
LOG="${VOICE_PREVIEW_LOG:-/tmp/voice-8095-preview.log}"
BACKOFF_START=1
BACKOFF_MAX=30
backoff="$BACKOFF_START"

echo "preview-supervise: starting (port=${PORT}) at $(date -Iseconds)" | tee -a "$LOG"

while true; do
  # Only clear OUR listener on PORT if it is already held by a stale child of a previous loop.
  # Never kill unrelated PIDs on other ports.
  if ss -tlnp 2>/dev/null | rg -q ":${PORT}\\b"; then
    echo "preview-supervise: port ${PORT} already listening — waiting" | tee -a "$LOG"
    sleep 5
    continue
  fi

  echo "preview-supervise: launch attempt $(date -Iseconds) backoff=${backoff}s" | tee -a "$LOG"
  set +e
  # --preview: low-RSS vite preview with inference+voice secrets
  "$ROOT/scripts/voice/dev-preview.sh" --preview >>"$LOG" 2>&1
  code=$?
  set -e
  echo "preview-supervise: child exited code=${code} at $(date -Iseconds)" | tee -a "$LOG"
  # Distinguish signal death (128+signal) vs clean exit when possible
  if [[ "$code" -ge 128 ]]; then
    echo "preview-supervise: likely signal/OOM (exit ${code})" | tee -a "$LOG"
  fi
  sleep "$backoff"
  if [[ "$backoff" -lt "$BACKOFF_MAX" ]]; then
    backoff=$((backoff * 2))
    if [[ "$backoff" -gt "$BACKOFF_MAX" ]]; then backoff=$BACKOFF_MAX; fi
  fi
done
