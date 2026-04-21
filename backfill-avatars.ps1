# ================================================================
# backfill-avatars.ps1
# Loops through backfill-avatars endpoint in chunks of 40 until all
# creators missing avatars have been processed.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File backfill-avatars.ps1
# ================================================================

$AdminPassword = Read-Host "Admin password"
$BatchSize     = 40
$Endpoint      = "https://contentlore.com/api/admin/backfill-avatars"
$MaxIterations = 10

$totalUpdated = 0
$totalErrors  = 0
$iter         = 0

Write-Host ""
Write-Host "Starting avatar backfill..." -ForegroundColor Cyan
Write-Host ""

while ($iter -lt $MaxIterations) {
  $iter++
  $body = @{ limit = $BatchSize } | ConvertTo-Json

  try {
    $response = Invoke-WebRequest `
      -Uri $Endpoint `
      -Method POST `
      -Headers @{'X-Admin-Password'=$AdminPassword; 'Content-Type'='application/json'} `
      -Body $body `
      -UseBasicParsing `
      -TimeoutSec 120
    $json = $response.Content | ConvertFrom-Json
  } catch {
    Write-Host "Iteration $iter FAILED: $_" -ForegroundColor Red
    Start-Sleep -Seconds 3
    continue
  }

  if (-not $json.ok) {
    Write-Host "Error: $($json.error)" -ForegroundColor Red
    break
  }

  $totalUpdated += $json.updated
  $totalErrors  += ($json.error_sample.Count)

  $errCounts = ""
  if ($json.error_counts) {
    $parts = @()
    foreach ($prop in $json.error_counts.PSObject.Properties) {
      if ($prop.Value -gt 0) { $parts += "$($prop.Name)=$($prop.Value)" }
    }
    if ($parts.Count -gt 0) { $errCounts = "  [errors: $($parts -join ', ')]" }
  }

  Write-Host ("Iter {0,2}  |  processed: {1,3}  updated: {2,3}{3}" -f $iter, $json.processed, $json.updated, $errCounts) -ForegroundColor Green

  if ($json.samples -and $json.samples.Count -gt 0) {
    $s = $json.samples[0]
    Write-Host ("  sample: {0} -> {1}" -f $s.display_name, $s.avatar_url.Substring(0, [Math]::Min(70, $s.avatar_url.Length))) -ForegroundColor DarkGray
  }

  # If nothing was updated AND nothing processed, we're done
  if ($json.processed -eq 0 -or $json.done) {
    Write-Host ""
    Write-Host "DONE." -ForegroundColor Cyan
    break
  }

  Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "Total avatars added: $totalUpdated" -ForegroundColor Green
Write-Host "Total errors:        $totalErrors" -ForegroundColor $(if ($totalErrors -gt 0) { 'Yellow' } else { 'Green' })
