# BBID Prototype Startup Script for Windows
# Detects OS, clears port 8000, and starts the server

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "BBID Prototype Startup Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Detect Windows version
$OS = [System.Environment]::OSVersion.Platform
Write-Host "Detected OS: Windows" -ForegroundColor Green

# Port to clear
$PORT = 8000

Write-Host ""
Write-Host "Checking port $PORT..." -ForegroundColor Yellow

# Find and kill process on port 8000
$PROCESS = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess

if ($PROCESS) {
    Write-Host "Port $PORT is in use by PID $PROCESS. Killing process..." -ForegroundColor Yellow
    Stop-Process -Id $PROCESS -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "Port $PORT cleared" -ForegroundColor Green
} else {
    Write-Host "Port $PORT is available" -ForegroundColor Green
}

# Check if virtual environment exists
if (-not (Test-Path "venv")) {
    Write-Host ""
    Write-Host "Virtual environment not found. Creating..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment
Write-Host ""
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& ".\venv\Scripts\Activate.ps1"

# Install dependencies if not already installed
Write-Host ""
Write-Host "Checking dependencies..." -ForegroundColor Yellow
pip install -q -r requirements.txt

# Start the server
Write-Host ""
Write-Host "Starting BBID server on port $PORT..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
python server.py
