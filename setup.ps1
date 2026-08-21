# One-time setup: dependencies, then the whole data pipeline.
# Safe to re-run; the OSM download is cached.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "`n=== 1/5  Python dependencies ===" -ForegroundColor Cyan
python -m pip install --quiet --no-warn-script-location `
    eclipse-sumo libsumo sumolib traci pyproj numpy `
    fastapi "uvicorn[standard]" requests

Write-Host "`n=== 2/5  Barcelona street network from OpenStreetMap ===" -ForegroundColor Cyan
python "$root\sim\fetch_osm.py"

Write-Host "`n=== 3/5  netconvert: OSM -> SUMO network ===" -ForegroundColor Cyan
python "$root\sim\build_net.py"

Write-Host "`n=== 4/5  demand generation (synthetic trips) ===" -ForegroundColor Cyan
python "$root\sim\build_demand.py" --end 3600

Write-Host "`n=== 5/6  export map geometry for the browser ===" -ForegroundColor Cyan
python "$root\sim\export_geo.py"

Write-Host "`n=== 6/6  real Open Data BCN layers (bike network) ===" -ForegroundColor Cyan
python "$root\sim\fetch_bcn_opendata.py"

Write-Host "`n=== npm dependencies ===" -ForegroundColor Cyan
npm --prefix "$root\web" install --no-audit --no-fund

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Start it with:  .\run.ps1" -ForegroundColor Green
