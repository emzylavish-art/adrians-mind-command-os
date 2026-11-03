#!/usr/bin/env bash
# Voice Wiring server on :8095 — loads inference + voice secrets without printing them.
# Usage:
#   ./scripts/voice/dev-preview.sh              # vite dev (heavy)
#   ./scripts/voice/dev-preview.sh --preview    # vite preview after build (low RSS)
#   VOICE_PREVIEW_MODE=preview ./scripts/voice/dev-preview.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INFERENCE_ENV="${XAI_INFERENCE_ENV_FILE:-/home/box/.secrets/xai_inference.env}"
VOICE_ENV="${XAI_VOICE_ENV_FILE:-/home/box/.secrets/xai_voice.env}"
PORT="${VOICE_PREVIEW_PORT:-8095}"
MODE="${VOICE_PREVIEW_MODE:-dev}"

for arg in "$@"; do
  case "$arg" in
    --preview|--serve) MODE=preview ;;
    --dev) MODE=dev ;;
    --port=*) PORT="${arg#--port=}" ;;
    *)
      echo "dev-preview: unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$INFERENCE_ENV" ]]; then
  echo "dev-preview: missing inference secrets file (path redacted)" >&2
  exit 1
fi
if [[ ! -f "$VOICE_ENV" ]]; then
  echo "dev-preview: missing voice secrets file (path redacted)" >&2
  exit 1
fi

# Drop any inherited management/chat mix so XAI_API_KEY cannot stay as the management token.
unset XAI_API_KEY || true

# shellcheck disable=SC1090
set -a
source "$INFERENCE_ENV"
source "$VOICE_ENV"
set +a

if [[ -z "${XAI_API_KEY:-}" ]]; then
  echo "dev-preview: XAI_API_KEY not set after sourcing inference env" >&2
  exit 1
fi
if [[ -z "${XAI_VOICE_API_KEY:-}" ]]; then
  echo "dev-preview: XAI_VOICE_API_KEY not set after sourcing voice env" >&2
  exit 1
fi

if [[ -n "${XAI_MANAGEMENT_KEY:-}" && "${XAI_API_KEY}" == "${XAI_MANAGEMENT_KEY}" ]]; then
  echo "dev-preview: refusing to start — XAI_API_KEY matches XAI_MANAGEMENT_KEY" >&2
  exit 1
fi

echo "dev-preview: mode=${MODE} chat_key_len=${#XAI_API_KEY} voice_key_len=${#XAI_VOICE_API_KEY} port=${PORT} cwd=${ROOT}"

export PATH="$ROOT/node_modules/.bin:$PATH"
# Cap V8 heap so preview stays friendly on a crowded box (does not affect other bots).
if [[ "$MODE" == "preview" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=256"
  exec node scripts/with-app-env.mjs vite preview --host 0.0.0.0 --port "$PORT" --strictPort
fi
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=512"

exec node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port "$PORT"
