#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! docker compose ps openclaw | grep -q 'syncpoly-openclaw'; then
  echo "OpenClaw is not running. Start it first with: npm run clawbot:start" >&2
  exit 1
fi

exec docker compose exec openclaw openclaw "$@"
