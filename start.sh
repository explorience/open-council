#!/bin/sh
set -e

echo "🚀 Starting Open Council Chatbot..."
echo ""

# Run embedding generation (incremental mode by default)
echo "Step 1: Checking for new embeddings..."
npm run chat:generate

echo ""
echo "Step 2: Starting chat server..."
exec npm run chat:server
