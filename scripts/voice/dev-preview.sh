#!/usr/bin/env bash
# Voice Wiring preview on :8095 — loads inference + voice secrets without printing them.
# Usage: from worktree root, or via absolute path. Leaves :8080 alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INFERENCE_ENV="${XAI_INFERENCE_ENV_FILE:-/home/box/.secrets/xai_inference.env}"
VOICE_ENV="${XAI_VOICE_ENV_FILE:-/home/box/.secrets/xai_voice.env}"
PORT="${VOICE_PREVIEW_PORT:-8095}"

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
# Inference file uses `export XAI_API_KEY=...`
source "$INFERENCE_ENV"
# Voice file is KEY=value (may or may not use export)
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

# If a management key is present in the environment, never let it alias as chat.
if [[ -n "${XAI_MANAGEMENT_KEY:-}" && "${XAI_API_KEY}" == "${XAI_MANAGEMENT_KEY}" ]]; then
  echo "dev-preview: refusing to start — XAI_API_KEY matches XAI_MANAGEMENT_KEY" >&2
  exit 1
fi

# Length-only sanity (never print values)
echo "dev-preview: chat_key_len=${#XAI_API_KEY} voice_key_len=${#XAI_VOICE_API_KEY} port=${PORT} cwd=${ROOT}"

export PATH="$ROOT/node_modules/.bin:$PATH"
exec node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port "$PORT"
