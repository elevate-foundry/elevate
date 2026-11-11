#!/bin/bash
# Kill anything on port 3900 and restart the server

echo "⠿ Killing port 3900..."
lsof -ti:3900 | xargs kill -9 2>/dev/null
sleep 1

echo "⠿ Starting ESCMC Benchmark Server..."
cd "$(dirname "$0")"
npx tsx src/server.ts
