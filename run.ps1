# Start the simulation server and the web app together.
# The server boots two SUMO processes; give it ~60 s before the map fills in.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$net = Join-Path $root "sim\net\barcelona.net.xml"
if (-not (Test-Path $net)) {
    Write-Host "Network not built yet. Run .\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting SUMO twin server on :8000 ..." -ForegroundColor Cyan
$server = Start-Process -FilePath "python" `
    -ArgumentList "app.py" `
    -WorkingDirectory (Join-Path $root "server") `
    -PassThru -WindowStyle Hidden

Write-Host "Starting web app on :5173 ..." -ForegroundColor Cyan
try {
    npm --prefix (Join-Path $root "web") run dev
}
finally {
    Write-Host "`nShutting the simulation server down ..." -ForegroundColor Cyan
    if ($server -and -not $server.HasExited) { $server.Kill() }
}
