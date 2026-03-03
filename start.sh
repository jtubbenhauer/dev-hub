#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

cleanup() {
  echo ""
  echo "Stopping next server (PID $NEXT_PID)..."
  kill "$NEXT_PID" 2>/dev/null
  wait "$NEXT_PID" 2>/dev/null
  echo "Done."
  exit 0
}

echo "Building..."
pnpm build

echo "Starting next server..."
pnpm start &> .next-server.log &
NEXT_PID=$!
trap cleanup INT TERM

sleep 2
echo "Starting cloudflared tunnel..."
cloudflared tunnel run dev-hub
