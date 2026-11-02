#!/usr/bin/env bash
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS_ROOT="${MIND_COMMAND_TOOLS_ROOT:-$ROOT/.tools}"
UPSTREAM_ROOT="$TOOLS_ROOT/upstream"
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
  if [[ -d "$path/.git" ]]; then
    found=$((found+1)); printf '[FOUND] %s — %s\n' "$label" "$path"
  else
    printf '[MISSING] %s — %s\n' "$label" "$path"
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
check_cmd UI-UX-Pro-Max ui-ux-pro-max
for id in everything-claude-code superpowers gsd-core ui-ux-pro-max n8n-mcp lightrag claude-mem obsidian-skills awesome-claude-code ghidra jadx frida owasp-zap gdb x64dbg; do
  check_dir "$id source" "$UPSTREAM_ROOT/$id"
done
printf '\nDetected %d of %d checks. Presence is not proof of runtime configuration or successful provider connection.\n' "$found" "$total"
