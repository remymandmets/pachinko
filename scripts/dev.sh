#!/usr/bin/env bash
set -euo pipefail

PORT=3001 NODE_ENV=development node --import tsx server/index.ts &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

./node_modules/.bin/vite --host 0.0.0.0 --port 3000
