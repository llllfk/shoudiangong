$ErrorActionPreference = "Stop"

$port = if ($env:DEPLOY_RUN_PORT) { $env:DEPLOY_RUN_PORT } else { "3000" }

Write-Host "Starting Next.js on port $port..."
& npm run start -- -H 0.0.0.0 -p $port
exit $LASTEXITCODE
