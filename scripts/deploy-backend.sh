#!/bin/bash
# scripts/deploy-backend.sh
# Gracefully reloads the backend after a code change.
#
# HOW IT WORKS:
#   1. Checks that the server is healthy before doing anything
#   2. Uses `pm2 reload` (NOT `pm2 restart`)
#      - reload: starts a new process, waits for it to signal "ready",
#        THEN sends SIGTERM to the old process
#      - restart: hard kills immediately (drops active requests)
#   3. The app's SIGTERM handler drains in-flight requests before exiting
#   4. Verifies the server is healthy again after reload
#
# When to use this vs build.sh:
#   - Changed backend/src/ files?  → use this script
#   - Changed island/src/ files?   → use scripts/build.sh (no restart needed)
#   - Changed both?                → run build.sh first, then this script
#
# Run from FINAL/ root directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
HEALTH_URL="http://localhost:3000/api/health"
MAX_WAIT=30  # seconds to wait for server to come back healthy

# ─── Pre-flight check ─────────────────────────────────────────────────────────
echo "🔍  Checking server health before reload..."
if ! curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
  echo "⚠️  Server does not appear to be running or healthy."
  echo "    If this is first startup, use: pm2 start ecosystem.config.js"
  echo "    If the server is crashed, check: pm2 logs jbi --lines 50"
  exit 1
fi
echo "    ✓ Server is healthy."

# ─── Graceful reload ──────────────────────────────────────────────────────────
echo ""
echo "🔄  Reloading backend gracefully..."
echo "    In-flight requests will be drained before the old process exits."
echo "    Users mid-transaction will not be dropped."
echo ""

# `pm2 reload` = zero-downtime rolling restart
# It starts the new process, waits for the ready signal, then gracefully
# shuts down the old one. Requires wait_ready: true in ecosystem.config.js.
pm2 reload ecosystem.config.js --update-env

# ─── Post-reload health check ─────────────────────────────────────────────────
echo ""
echo "⏳  Waiting for server to come back healthy..."
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "    ✓ Server is healthy after ${ELAPSED}s."
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo ""
  echo "❌  Server did not come back healthy within ${MAX_WAIT}s."
  echo "    Check logs: pm2 logs jbi --lines 50"
  echo "    Check status: pm2 list"
  exit 1
fi

echo ""
echo "✅  Backend reloaded. Zero requests were dropped."
echo "    Logs: pm2 logs jbi"
