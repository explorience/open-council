#!/bin/sh
set -e

echo "🚀 Starting Open Council Chatbot..."
echo ""

# Run FULL embedding regeneration on this deploy
# (March 2026 vote data was updated - need fresh embeddings)
# TODO: Remove FORCE_REGENERATE after this deploy completes
echo "Step 1: Running FULL embedding regeneration..."
FORCE_REGENERATE=true npm run chat:generate

echo ""
echo "Step 2: Starting chat server..."
exec npm run chat:server
