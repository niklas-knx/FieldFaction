# Holt den neuesten Stand, baut Client + Server und startet den PM2-Prozess neu.
# Voraussetzung: PM2-Prozess heißt "fieldfaction" (siehe README, Abschnitt Deployment),
# `pm2` liegt im PATH. Bei jedem Fehler (git pull/build schlägt fehl) bricht das Skript
# ab, statt mit einem halb aktualisierten/kaputten Stand neu zu starten.
#
# Aufruf, aus einem beliebigen Verzeichnis:  powershell -File deploy\redeploy.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $repoRoot
Write-Host "== git pull ($repoRoot) ==" -ForegroundColor Cyan
git pull

Write-Host "== npm run build:all ==" -ForegroundColor Cyan
npm run build:all

Write-Host "== pm2 restart fieldfaction ==" -ForegroundColor Cyan
pm2 restart fieldfaction

Start-Sleep -Seconds 2
Write-Host "== Health-Check ==" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 5
  if ($health.ok) {
    Write-Host "OK — Server läuft." -ForegroundColor Green
  } else {
    Write-Warning "Server antwortet, aber nicht wie erwartet: $($health | ConvertTo-Json -Compress)"
  }
} catch {
  Write-Warning "Health-Check fehlgeschlagen — mit 'pm2 logs fieldfaction' nachsehen: $_"
}
