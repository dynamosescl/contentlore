Param(
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'

Write-Host "== ContentLore local preview ==" -ForegroundColor Cyan
Write-Host "Working directory: $(Get-Location)"

if (Test-Path .git) {
  git status -sb
}

Write-Host "Starting Wrangler preview on port $Port..." -ForegroundColor Yellow
npx wrangler pages dev . --port $Port
