#!/usr/bin/env bash
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS_ROOT="${MIND_COMMAND_TOOLS_ROOT:-$ROOT/.tools}"
UPSTREAM_ROOT="$ROOT/upstream"
export PATH="${HOME}/.local/bin:${PATH}"
jdk_bin="$(compgen -G "$TOOLS_ROOT/jdk/*/bin/java" 2>/dev/null | head -1 || true)"
if [[ -n "$jdk_bin" ]]; then
  export JAVA_HOME="$(dirname "$(dirname "$jdk_bin")")"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
jadx_bin="$(find "$TOOLS_ROOT/apps" -type f -path '*/bin/jadx' 2>/dev/null | head -1 || true)"
if [[ -n "$jadx_bin" ]]; then
  export PATH="$(dirname "$jadx_bin"):$PATH"
fi
found=0
total=0
check_cmd() {
  local label="$1" command="$2"
  total=$((total+1))
  if command -v "$command" >/dev/null 2>&1; then
    found=$((found+1)); printf '[FOUND] %s — %s\n' "$label" "$(command -v "$command")"
  else
    printf '[MISSING] %s — command %s\n' "$label" "$command"
  fi
}
check_dir() {
  local label="$1" path="$2"
  total=$((total+1))
  if [[ -d "$path/.git" || -f "$path/.git" ]]; then
    found=$((found+1)); printf '[FOUND] %s — %s\n' "$label" "$path"
  else
    printf '[MISSING] %s — %s\n' "$label" "$path"
  fi
}
check_found_file() {
  local label="$1" match="$2"
  local path
  total=$((total+1))
  path="$(find "$TOOLS_ROOT/apps" -type f -name "$match" 2>/dev/null | head -1 || true)"
  if [[ -n "$path" ]]; then
    found=$((found+1)); printf '[FOUND] %s — %s\n' "$label" "$path"
  else
    printf '[MISSING] %s — file %s under %s\n' "$label" "$match" "$TOOLS_ROOT/apps"
  fi
}
printf 'Mind Command OS GitHub/Codespaces workspace verification\n'
check_cmd Git git
check_cmd Node node
check_cmd npm npm
check_cmd Python python
check_cmd Java java
check_cmd Frida frida
check_cmd GDB gdb
check_cmd n8n-MCP n8n-mcp
check_cmd UI-UX-Pro-Max uipro
check_cmd 21st-Magic magic
check_cmd JADX jadx
check_found_file "Ghidra headless" analyzeHeadless
check_found_file "OWASP ZAP launcher" zap.sh
for id in l1b3rt4s everything-claude-code superpowers gsd-core ui-ux-pro-max 21st-magic taste-skill gsap lenis react-bits hallmark impeccable scrapling pixelrag n8n-mcp lightrag claude-mem obsidian-skills awesome-claude-code ghidra jadx frida owasp-zap gdb x64dbg comfyui open-higgsfield weknora openwhispr openproject cal-diy chatwoot cap; do
  check_dir "$id source" "$UPSTREAM_ROOT/$id"
done
check_dir "h4cker source" "$ROOT/security-repos/h4cker"
check_dir "heretic source" "$ROOT/security-repos/heretic"
printf '\nDetected %d of %d checks. Presence is not proof of runtime configuration or successful provider connection.\n' "$found" "$total"
