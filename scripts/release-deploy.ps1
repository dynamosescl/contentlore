Param(
  [string]$ProjectName = 'contentlore'
)

$ErrorActionPreference = 'Stop'

Write-Host "== ContentLore deploy ==" -ForegroundColor Cyan
Write-Host "Working directory: $(Get-Location)"

if (Test-Path .git) {
  git status -sb
}

Write-Host "Deploying to Cloudflare Pages project '$ProjectName'..." -ForegroundColor Yellow
npx wrangler pages deploy . --project-name $ProjectName
