#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS_ROOT="${MIND_COMMAND_TOOLS_ROOT:-$ROOT/.tools}"
UPSTREAM_ROOT="$TOOLS_ROOT/upstream"
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
npm install --global n8n-mcp ui-ux-pro-max-cli || warn "One or more npm packages did not finish installing."

log "Checking out the approved upstream source catalog"
while IFS=$'\t' read -r id url; do
  [[ -z "$id" || "$id" == "id" ]] && continue
  clone_or_update "$id" "$url"
done <<'CATALOG'
id	url
everything-claude-code	https://github.com/affaan-m/ECC.git
superpowers	https://github.com/obra/superpowers.git
gsd-core	https://github.com/gsd-build/get-shit-done.git
ui-ux-pro-max	https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git
n8n-mcp	https://github.com/czlonkowski/n8n-mcp.git
lightrag	https://github.com/HKUDS/LightRAG.git
claude-mem	https://github.com/thedotmack/claude-mem.git
obsidian-skills	https://github.com/kepano/obsidian-skills.git
awesome-claude-code	https://github.com/subinium/awesome-claude-code.git
ghidra	https://github.com/NationalSecurityAgency/ghidra.git
jadx	https://github.com/skylot/jadx.git
frida	https://github.com/frida/frida.git
owasp-zap	https://github.com/zaproxy/zaproxy.git
gdb	https://github.com/bminor/binutils-gdb.git
x64dbg	https://github.com/x64dbg/x64dbg.git
CATALOG

log "Workspace source and package setup finished (per-tool status is reported by verifier)."
log "Security/reverse-engineering tools are for owned or explicitly authorized targets."
log "This setup does not activate third-party plugins or configure external API credentials."
log "BlackEye phishing/credential collection remains excluded; unknown-source entries remain disabled."
