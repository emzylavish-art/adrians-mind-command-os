#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS_ROOT="${MIND_COMMAND_TOOLS_ROOT:-$ROOT/.tools}"
UPSTREAM_ROOT="$ROOT/upstream"
LOG_ROOT="$TOOLS_ROOT/logs"
mkdir -p "$UPSTREAM_ROOT" "$LOG_ROOT"

log() { printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

clone_or_update() {
  local id="$1" url="$2" target="$UPSTREAM_ROOT/$1"
  if [[ -d "$target/.git" ]]; then
    log "Fast-forward update: $id"
    git -C "$target" pull --ff-only || warn "$id update failed; preserved existing checkout."
  elif [[ -e "$target" ]]; then
    warn "$target exists but is not a Git checkout; leaving it untouched."
  else
    log "Clone upstream source: $id"
    git clone --depth 1 "$url" "$target" || warn "Clone failed for $id; continuing."
  fi
}

log "Installing Python integration packages into this Codespace environment"
python -m pip install --user --upgrade frida-tools 'lightrag-hku[api]' || warn "Python package install did not finish; see pip output."

log "Installing declared Node integration packages"
npm install --prefix "$TOOLS_ROOT/npm" --global n8n-mcp ui-ux-pro-max-cli || warn "One or more npm packages did not finish installing."

log "Initializing pinned upstream Git submodules in this GitHub repository"
git -C "$ROOT" submodule update --init --recursive || warn "One or more submodules did not initialize; inspect Git output and rerun."

log "Workspace source and package setup finished (per-tool status is reported by verifier)."
log "Security/reverse-engineering tools are for owned or explicitly authorized targets."
log "This setup does not activate third-party plugins or configure external API credentials."
log "BlackEye phishing/credential collection remains excluded; unknown-source entries remain disabled."
