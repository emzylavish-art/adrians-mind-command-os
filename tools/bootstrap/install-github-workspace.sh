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
npm install --global n8n-mcp ui-ux-pro-max-cli || warn "One or more npm packages did not finish installing."

log "Initializing pinned upstream Git submodules in this GitHub repository"
git -C "$ROOT" submodule update --init --recursive --depth 1 --jobs 4 || warn "One or more submodules did not initialize; inspect Git output and rerun."

APPS="$TOOLS_ROOT/apps"
mkdir -p "$APPS"
python3 - "$APPS" <<'PY' || warn "One or more release archives did not download."
import json, os, re, sys, tarfile, urllib.request, zipfile
dest = sys.argv[1]
wanted = [
    ("NationalSecurityAgency/ghidra", r"^ghidra_.*\.zip$", "ghidra"),
    ("skylot/jadx", r"^jadx-\d.*\.zip$", "jadx"),
    ("zaproxy/zaproxy", r"^ZAP_.*_Linux\.tar\.gz$", "zap"),
]
for repo, pattern, name in wanted:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"User-Agent": "Adrians-Mind-Command-OS-Installer", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        release = json.load(response)
    asset = next((item for item in release.get("assets", []) if re.search(pattern, item["name"])), None)
    if not asset:
        print(f"[WARN] No release asset matching {pattern} for {repo}", file=sys.stderr)
        continue
    archive = os.path.join(dest, asset["name"])
    if not (os.path.exists(archive) and os.path.getsize(archive) > 0):
        print(f"Downloading {asset['name']}")
        urllib.request.urlretrieve(asset["browser_download_url"], archive)
    else:
        print(f"Already present: {archive}")
    if archive.endswith(".zip"):
        marker = os.path.join(dest, "." + name + ".extracted")
        if not os.path.exists(marker):
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(dest)
            open(marker, "w").close()
    elif archive.endswith(".tar.gz"):
        marker = os.path.join(dest, "." + name + ".extracted")
        if not os.path.exists(marker):
            with tarfile.open(archive, "r:gz") as tf:
                tf.extractall(dest)
            open(marker, "w").close()
PY

if ! java -version 2>&1 | head -1 | grep -Eq '"(2[1-9]|[3-9][0-9])'; then
  log "Installing Temurin JDK 25 for Ghidra"
  mkdir -p "$TOOLS_ROOT/jdk"
  if ! compgen -G "$TOOLS_ROOT/jdk/*/bin/java" >/dev/null; then
    curl -fsSL -o "$TOOLS_ROOT/jdk/temurin25.tar.gz" \
      "https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk" \
      || warn "Temurin JDK 25 download failed."
    if [[ -f "$TOOLS_ROOT/jdk/temurin25.tar.gz" ]]; then
      tar -xzf "$TOOLS_ROOT/jdk/temurin25.tar.gz" -C "$TOOLS_ROOT/jdk" || warn "Temurin JDK 25 extract failed."
    fi
  fi
fi
if [[ ! -e /dev/fd && -d /proc/self/fd ]]; then
  ln -s /proc/self/fd /dev/fd || warn "Could not link /dev/fd; Ghidra headless launch may fail."
fi

log "Workspace source and package setup finished (per-tool status is reported by verifier)."
log "Security/reverse-engineering tools are for owned or explicitly authorized targets."
log "This setup does not activate third-party plugins or configure external API credentials."
log "BlackEye phishing/credential collection remains excluded; unknown-source entries remain disabled."
