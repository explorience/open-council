#!/bin/sh

echo "🚀 Starting Open Council Chatbot..."
echo ""

# Run embedding generation (incremental mode by default)
# Non-fatal: if this fails (e.g. OpenAI quota exceeded), continue to server startup
echo "Step 1: Checking for new embeddings..."
if npm run chat:generate; then
  echo "✅ Embeddings up to date."
else
  echo "⚠️  Embedding generation failed (server will start with existing embeddings)."
fi

echo ""
echo "Step 2: Starting chat server..."
exec npm run chat:server
