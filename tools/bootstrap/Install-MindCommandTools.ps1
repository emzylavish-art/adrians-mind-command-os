#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:USERPROFILE "AdriansMind"),
    [switch]$SkipSystemPackages,
    [switch]$SkipSourceClones,
    [switch]$SkipPythonPackages,
    [switch]$SkipNpmPackages,
    [switch]$SkipDesktopTools
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host ("=== " + $Message + " ===") -ForegroundColor Cyan
}
function Write-Warn([string]$Message) {
    Write-Host ("[NOTICE] " + $Message) -ForegroundColor Yellow
}
function Invoke-WingetInstall([string]$Id) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Warn "winget is unavailable; skipped $Id."
        return
    }
    Write-Host "Installing $Id ..."
    & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "winget returned exit code $LASTEXITCODE for $Id. Continuing with the remaining tools."
    }
}
function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machine, $user, $env:Path) -join ";"
}
function Clone-OrUpdate([string]$Name, [string]$Url) {
    $target = Join-Path (Join-Path $InstallRoot "upstream-tools") $Name
    if (Test-Path (Join-Path $target ".git")) {
        Write-Host "Updating $Name ..."
        & $script:GitExe -C $target pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Warn "Could not fast-forward $Name; existing checkout was left unchanged." }
        return
    }
    if (Test-Path $target) {
        Write-Warn "$target exists but is not a Git checkout; left untouched."
        return
    }
    Write-Host "Cloning $Name ..."
    & $script:GitExe clone --depth 1 $Url $target
    if ($LASTEXITCODE -ne 0) { Write-Warn "Clone failed for $Name." }
}
function Get-LatestGithubZip([string]$Repo, [string]$Pattern, [string]$DestinationName) {
    try {
        $headers = @{ "User-Agent" = "Adrians-Mind-Command-OS-Installer" }
        $release = Invoke-RestMethod -Headers $headers -Uri ("https://api.github.com/repos/" + $Repo + "/releases/latest")
        $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
        if (-not $asset) {
            Write-Warn "No matching release ZIP found for $Repo. Source checkout remains available."
            return
        }
        $apps = Join-Path $InstallRoot "apps"
        New-Item -ItemType Directory -Force -Path $apps | Out-Null
        $zip = Join-Path $apps $asset.name
        $destination = Join-Path $apps $DestinationName
        Write-Host "Downloading $($asset.name) ..."
        Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $zip
        if (Test-Path $destination) {
            $destination = Join-Path $apps ($DestinationName + "-" + ($release.tag_name -replace '[^A-Za-z0-9._-]', '_'))
        }
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $destination -Force
        Write-Host "Extracted to $destination"
    } catch {
        Write-Warn "Release download for $Repo did not complete: $($_.Exception.Message)"
    }
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Write-Host "Mind Command OS tool setup" -ForegroundColor Green
Write-Host "Install location: $InstallRoot"
Write-Host "This installs third-party software and checks out upstream repositories. Review upstream licenses and only use security tools on systems you own or are authorized to test."

if (-not $SkipSystemPackages) {
    Write-Step "Windows prerequisites"
    foreach ($package in @(
        "Git.Git",
        "OpenJS.NodeJS.LTS",
        "Python.Python.3.12",
        "EclipseAdoptium.Temurin.25.JDK"
    )) {
        Invoke-WingetInstall $package
    }
    if (-not $SkipDesktopTools) { Invoke-WingetInstall "MSYS2.MSYS2" }
    Refresh-ProcessPath
}

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    $candidate = Join-Path $env:ProgramFiles "Git\cmd\git.exe"
    if (Test-Path $candidate) { $script:GitExe = $candidate }
    else { Write-Warn "Git is not available in this terminal. Source clones will be skipped; install Git and rerun." }
} else {
    $script:GitExe = $git.Source
}

if (-not $SkipSourceClones) {
    Write-Step "Official upstream source checkouts"
    $repos = @(
        @("everything-claude-code", "https://github.com/affaan-m/ECC.git"),
        @("superpowers", "https://github.com/obra/superpowers.git"),
        @("gsd-core", "https://github.com/gsd-build/get-shit-done.git"),
        @("ui-ux-pro-max", "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git"),
        @("n8n-mcp", "https://github.com/czlonkowski/n8n-mcp.git"),
        @("lightrag", "https://github.com/HKUDS/LightRAG.git"),
        @("claude-mem", "https://github.com/thedotmack/claude-mem.git"),
        @("obsidian-skills", "https://github.com/kepano/obsidian-skills.git"),
        @("awesome-claude-code", "https://github.com/subinium/awesome-claude-code.git"),
        @("ghidra", "https://github.com/NationalSecurityAgency/ghidra.git"),
        @("jadx", "https://github.com/skylot/jadx.git"),
        @("frida", "https://github.com/frida/frida.git"),
        @("owasp-zap", "https://github.com/zaproxy/zaproxy.git"),
        @("gdb", "https://github.com/bminor/binutils-gdb.git"),
        @("x64dbg", "https://github.com/x64dbg/x64dbg.git")
    )
    foreach ($item in $repos) {
        if ($script:GitExe) { Clone-OrUpdate $item[0] $item[1] }
    }
}

if (-not $SkipNpmPackages) {
    Write-Step "Node.js tools"
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        & npm install --global n8n-mcp ui-ux-pro-max-cli
        if ($LASTEXITCODE -ne 0) { Write-Warn "One or more npm packages did not install; check Node.js/npm and rerun." }
    } else {
        Write-Warn "npm is unavailable; n8n-MCP and UI UX Pro Max CLI were not installed."
    }
}

if (-not $SkipPythonPackages) {
    Write-Step "Python tools"
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
    if ($python) {
        & $python.Source -m pip install --user --upgrade frida-tools "lightrag-hku[api]"
        if ($LASTEXITCODE -ne 0) { Write-Warn "One or more Python packages failed. Inspect the pip output and rerun." }
    } else {
        Write-Warn "Python is unavailable; Frida tools and LightRAG package were not installed."
    }
}

if (-not $SkipDesktopTools) {
    Write-Step "Desktop reverse-engineering and security tools"
    foreach ($package in @("ZAP.ZAP", "PortSwigger.BurpSuite.Community")) {
        Invoke-WingetInstall $package
    }
    Get-LatestGithubZip "NationalSecurityAgency/ghidra" "^ghidra_.*\.zip$" "ghidra"
    Get-LatestGithubZip "skylot/jadx" "^jadx.*\.zip$" "jadx"
    Get-LatestGithubZip "x64dbg/x64dbg" "(?i).*\.zip$" "x64dbg"

    $bash = "C:\msys64\usr\bin\bash.exe"
    if (Test-Path $bash) {
        Write-Host "Installing GDB inside MSYS2 ..."
        & $bash -lc "pacman -Syu --noconfirm"
        & $bash -lc "pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-gdb"
        if ($LASTEXITCODE -ne 0) { Write-Warn "GDB package installation did not complete. Run the two pacman commands in the MSYS2 UCRT64 shell." }
    } else {
        Write-Warn "MSYS2 was not found at C:\msys64; GDB remains source-only. Install MSYS2 and rerun this script."
    }
}

Write-Step "Setup summary"
Write-Host "Upstream source checkouts: $InstallRoot\upstream-tools"
Write-Host "Downloaded application archives: $InstallRoot\apps"
Write-Host "Installed Node/Python/security apps depend on the package-manager output above."
Write-Host "LightRAG still needs a model/embedding provider and secure local configuration."
Write-Host "Claude-oriented skills/plugins may need explicit activation in the relevant client; this script does not overwrite your Codex/Claude settings."
Write-Host "God's Eyes and Arrow EA are excluded until their exact official projects are identified."
Write-Host "BlackEye remains excluded because phishing/credential-harvesting deployment is not integrated."
Write-Host "For a rerun, execute this same script again; source checkouts use fast-forward-only updates."
