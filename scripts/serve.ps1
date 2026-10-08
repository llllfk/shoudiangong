$ErrorActionPreference = "Stop"

$port = if ($env:DEPLOY_RUN_PORT) { $env:DEPLOY_RUN_PORT } elseif ($env:PORT) { $env:PORT } else { "3000" }

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path ".next")) {
  Write-Host "Building Next.js app..."
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting Next.js on port $port..."
& npm run start -- -H 0.0.0.0 -p $port
exit $LASTEXITCODE
