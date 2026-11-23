$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here "windows-acceptance.mjs")
exit $LASTEXITCODE
