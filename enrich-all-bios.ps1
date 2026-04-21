# ================================================================
# enrich-all-bios.ps1
# Loops through enrich-batch endpoint in chunks of 10 until all
# creators have been processed. Prints progress line per batch.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File enrich-all-bios.ps1
# ================================================================

$AdminPassword = Read-Host "Admin password"
$BatchSize     = 10
$Mode          = "low_quality"  # 'low_quality' | 'empty_only' | 'all'
$Endpoint      = "https://contentlore.com/api/admin/creators/enrich-batch"

$offset = 0
$totalEnriched = 0
$totalSkipped  = 0
$totalErrors   = 0
$batchNum      = 0

Write-Host ""
Write-Host "Starting bio enrichment across all creators..." -ForegroundColor Cyan
Write-Host "Mode: $Mode | Batch size: $BatchSize" -ForegroundColor Gray
Write-Host ""

while ($true) {
  $batchNum++
  $body = @{
    offset = $offset
    batch  = $BatchSize
    mode   = $Mode
  } | ConvertTo-Json

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
    Write-Host "Batch $batchNum FAILED: $_" -ForegroundColor Red
    Start-Sleep -Seconds 3
    continue
  }

  if (-not $json.ok) {
    Write-Host "Batch $batchNum returned error: $($json.error)" -ForegroundColor Red
    break
  }

  $totalEnriched += $json.enriched
  $totalSkipped  += $json.skipped
  $totalErrors   += $json.errors
  $offset         = $json.next_offset

  $pct = $json.progress_pct
  Write-Host ("Batch {0,3}  |  Progress {1,3}%  |  enriched: {2,3}  skipped: {3,3}  errors: {4,2}  |  totals: {5}/{6}/{7}" -f $batchNum, $pct, $json.enriched, $json.skipped, $json.errors, $totalEnriched, $totalSkipped, $totalErrors) -ForegroundColor Green

  # Print one sample so we can eyeball voice quality mid-run
  if ($json.samples -and $json.samples.Count -gt 0) {
    $s = $json.samples[0]
    Write-Host ("  sample: {0} -> {1}" -f $s.display_name, $s.new_bio) -ForegroundColor DarkGray
  }

  if ($json.done) {
    Write-Host ""
    Write-Host "DONE." -ForegroundColor Cyan
    Write-Host "Total enriched: $totalEnriched" -ForegroundColor Green
    Write-Host "Total skipped:  $totalSkipped" -ForegroundColor Yellow
    Write-Host "Total errors:   $totalErrors" -ForegroundColor $(if ($totalErrors -gt 0) { 'Red' } else { 'Green' })
    break
  }

  # Small pause to avoid rate limiting the Anthropic API
  Start-Sleep -Milliseconds 500
}
