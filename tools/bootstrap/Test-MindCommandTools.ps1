#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:USERPROFILE "AdriansMind"),
    [switch]$Json
)

$ErrorActionPreference = "Continue"
$sourceRoot = Join-Path $InstallRoot "upstream-tools"
$appRoot = Join-Path $InstallRoot "apps"

$checks = @(
    @{ id = "git"; label = "Git"; command = "git"; path = $null },
    @{ id = "node"; label = "Node.js"; command = "node"; path = $null },
    @{ id = "npm"; label = "npm"; command = "npm"; path = $null },
    @{ id = "python"; label = "Python"; command = "python"; path = $null },
    @{ id = "java"; label = "Java runtime"; command = "java"; path = $null },
    @{ id = "n8n-mcp-source"; label = "n8n-MCP source"; command = $null; path = (Join-Path $sourceRoot "n8n-mcp") },
    @{ id = "ecc-source"; label = "Everything Claude Code source"; command = $null; path = (Join-Path $sourceRoot "everything-claude-code") },
    @{ id = "superpowers-source"; label = "Superpowers source"; command = $null; path = (Join-Path $sourceRoot "superpowers") },
    @{ id = "gsd-source"; label = "GSD Core source"; command = $null; path = (Join-Path $sourceRoot "gsd-core") },
    @{ id = "ui-ux-pro-max-source"; label = "UI UX Pro Max source"; command = $null; path = (Join-Path $sourceRoot "ui-ux-pro-max") },
    @{ id = "lightrag-source"; label = "LightRAG source"; command = $null; path = (Join-Path $sourceRoot "lightrag") },
    @{ id = "claude-mem-source"; label = "Claude Mem source"; command = $null; path = (Join-Path $sourceRoot "claude-mem") },
    @{ id = "obsidian-skills-source"; label = "Obsidian Skills source"; command = $null; path = (Join-Path $sourceRoot "obsidian-skills") },
    @{ id = "awesome-claude-code-source"; label = "Awesome Claude Code catalog"; command = $null; path = (Join-Path $sourceRoot "awesome-claude-code") },
    @{ id = "ghidra-source"; label = "Ghidra source"; command = $null; path = (Join-Path $sourceRoot "ghidra") },
    @{ id = "jadx-source"; label = "JADX source"; command = $null; path = (Join-Path $sourceRoot "jadx") },
    @{ id = "frida-source"; label = "Frida source"; command = $null; path = (Join-Path $sourceRoot "frida") },
    @{ id = "zap-source"; label = "OWASP ZAP source"; command = $null; path = (Join-Path $sourceRoot "owasp-zap") },
    @{ id = "gdb-source"; label = "GDB source"; command = $null; path = (Join-Path $sourceRoot "gdb") },
    @{ id = "x64dbg-source"; label = "x64dbg source"; command = $null; path = (Join-Path $sourceRoot "x64dbg") }
)

$results = foreach ($check in $checks) {
    $found = $false
    $evidence = $null
    if ($check.command) {
        $cmd = Get-Command $check.command -ErrorAction SilentlyContinue
        if ($cmd) {
            $found = $true
            $evidence = $cmd.Source
        }
    } elseif ($check.path -and (Test-Path -LiteralPath $check.path)) {
        $found = $true
        $evidence = $check.path
    }

    [pscustomobject]@{
        id = $check.id
        name = $check.label
        detected = $found
        evidence = $evidence
    }
}

$report = [pscustomobject]@{
    install_root = $InstallRoot
    checked_at = (Get-Date).ToString("o")
    detected_count = @($results | Where-Object detected).Count
    check_count = @($results).Count
    checks = @($results)
}

if ($Json) {
    $report | ConvertTo-Json -Depth 5
} else {
    Write-Host "Mind Command OS installation check" -ForegroundColor Cyan
    Write-Host "Install root: $InstallRoot"
    foreach ($item in $results) {
        $status = if ($item.detected) { "FOUND" } else { "MISSING" }
        $color = if ($item.detected) { "Green" } else { "Yellow" }
        Write-Host ("[{0}] {1}" -f $status, $item.name) -ForegroundColor $color
        if ($item.evidence) { Write-Host ("       " + $item.evidence) }
    }
    Write-Host ""
    Write-Host ("Detected {0} of {1} checks. This checks presence only; it does not certify that a tool is configured or operational." -f $report.detected_count, $report.check_count)
}
