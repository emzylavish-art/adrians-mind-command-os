#!/usr/bin/env bash
# Build (if needed) then serve the voice-wiring tip on :8095 via vite preview.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PATH="$ROOT/node_modules/.bin:$PATH"
# Build uses a modest heap; fail clearly if OOM.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=2048"
echo "preview-serve: building…"
npm run build
echo "preview-serve: starting vite preview on :8095"
exec "$ROOT/scripts/voice/dev-preview.sh" --preview
