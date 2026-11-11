#!/bin/bash

# BBID Prototype Startup Script for Mac/Linux
# Detects OS, clears port 8000, and starts the server

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "BBID Prototype Startup Script"
echo "=========================================="

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
    echo -e "${GREEN}Detected OS: macOS${NC}"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="Linux"
    echo -e "${GREEN}Detected OS: Linux${NC}"
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    exit 1
fi

# Port to clear
PORT=8000

echo ""
echo -e "${YELLOW}Checking port $PORT...${NC}"

# Find and kill process on port 8000
if [[ "$OS" == "macOS" ]]; then
    PID=$(lsof -ti:$PORT 2>/dev/null || true)
    if [[ -n "$PID" ]]; then
        echo -e "${YELLOW}Port $PORT is in use by PID $PID. Killing process...${NC}"
        kill -9 $PID 2>/dev/null || true
        sleep 1
        echo -e "${GREEN}Port $PORT cleared${NC}"
    else
        echo -e "${GREEN}Port $PORT is available${NC}"
    fi
elif [[ "$OS" == "Linux" ]]; then
    PID=$(fuser -k $PORT/tcp 2>/dev/null || true)
    if [[ -n "$PID" ]]; then
        echo -e "${YELLOW}Port $PORT was in use. Killed processes${NC}"
        sleep 1
        echo -e "${GREEN}Port $PORT cleared${NC}"
    else
        echo -e "${GREEN}Port $PORT is available${NC}"
    fi
fi

# Check if virtual environment exists
if [[ ! -d "venv" ]]; then
    echo ""
    echo -e "${YELLOW}Virtual environment not found. Creating...${NC}"
    python3 -m venv venv
fi

# Activate virtual environment
echo ""
echo -e "${YELLOW}Activating virtual environment...${NC}"
source venv/bin/activate

# Install dependencies if not already installed
echo ""
echo -e "${YELLOW}Checking dependencies...${NC}"
pip install -q -r requirements.txt

# Start the server
echo ""
echo -e "${GREEN}Starting BBID server on port $PORT...${NC}"
echo "=========================================="
python server.py
