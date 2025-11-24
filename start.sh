#!/bin/bash
set -e

# Run embedding generation (incremental mode by default)
echo "Starting embedding generation..."
npm run chat:generate

# Start the chat server
echo "Starting chat server..."
exec npm run chat:server
