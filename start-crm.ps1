$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$crmNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $crmNode) {
  $crmNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $crmNode)) { throw 'Install Node.js 22 or later first.' }
if (-not (Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) { throw 'Run pnpm install and pnpm db:init first. See README.md.' }
if (-not (Test-Path -LiteralPath '.next/BUILD_ID')) {
  & $crmNode node_modules/next/dist/bin/next build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Write-Host 'CRM: http://127.0.0.1:3000  (Ctrl+C to stop)'
& $crmNode node_modules/next/dist/bin/next start --hostname 127.0.0.1
