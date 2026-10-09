#!/bin/sh
set -eu

PORT="${DEPLOY_RUN_PORT:-${PORT:-3000}}"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -d .next ]; then
  echo "Building Next.js app..."
  npm run build
fi

echo "Starting Next.js on 0.0.0.0:${PORT}..."
exec npm run start -- -H 0.0.0.0 -p "${PORT}"
