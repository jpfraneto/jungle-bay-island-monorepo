#!/bin/bash
# scripts/build.sh
# Builds the React frontend and deploys it to the backend's static directory.
#
# IMPORTANT: This does NOT restart the backend.
# The backend serves static files from backend/public/island/ on every request.
# Replacing those files is enough — no restart needed, zero downtime.
#
# Run this from the FINAL/ root directory after any frontend (island/) change.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
ISLAND="$ROOT/island"
BACKEND_PUBLIC="$ROOT/backend/public/island"

echo "🏝️  Building Jungle Bay Island frontend..."
cd "$ISLAND"
bun run build

echo "📦  Deploying to backend/public/island/ ..."
# Atomic-ish swap: copy new build to a temp dir, then replace in one move.
# This minimizes the window where the directory is partially updated.
TEMP_DIR="$(mktemp -d)"
cp -r "$ISLAND/dist/." "$TEMP_DIR/"
rm -rf "$BACKEND_PUBLIC"
mv "$TEMP_DIR" "$BACKEND_PUBLIC"

echo ""
echo "✅  Frontend deployed. No backend restart needed."
echo "    Hard-refresh your browser (Cmd+Shift+R) to see changes."
echo "    Downtime: zero"
