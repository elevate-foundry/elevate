# Cross-device verification for famulus (native Windows PowerShell 5.1+).
#
# Use this on Windows if you are NOT in Git Bash/WSL. It runs the
# zero-dependency selfcheck (the must-pass gate) and then, best effort, the
# full pytest suite. Invoke as:
#   powershell -ExecutionPolicy Bypass -File scripts\verify.ps1

$ErrorActionPreference = "Stop"

# Move to the repo root (the parent of this script's directory).
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Find a Python interpreter (3.9+ required).
$py = $null
foreach ($cand in @("python", "python3", "py")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $py = $cand; break }
}
if (-not $py) {
    Write-Error "No Python found. Install Python 3.9+ from python.org (check 'Add to PATH') and retry."
    exit 127
}

Write-Host "============================================================"
Write-Host " famulus :: cross-device verification"
Write-Host "============================================================"
Write-Host " host   : $env:COMPUTERNAME"
Write-Host " system : $([System.Environment]::OSVersion.VersionString) ($env:PROCESSOR_ARCHITECTURE)"
Write-Host " python : $(& $py -V 2>&1) ($py)"
try { $commit = (& git rev-parse --short HEAD 2>$null) } catch { $commit = "no-git" }
Write-Host " commit : $commit"
Write-Host "------------------------------------------------------------"

# 1) Zero-dependency selfcheck -- the gate.
Write-Host "[1/2] zero-dependency selfcheck"
& $py -m famulus.selfcheck
if ($LASTEXITCODE -ne 0) {
    Write-Host "------------------------------------------------------------"
    Write-Error "SELFCHECK FAILED on this device. Copy the output above."
    exit 1
}
Write-Host "------------------------------------------------------------"

# 2) Full pytest suite -- best effort.
Write-Host "[2/2] full pytest suite (best-effort)"
& $py -m venv .venv 2>$null
$vpy = Join-Path $root ".venv\Scripts\python.exe"
if (Test-Path $vpy) {
    & $vpy -m pip install -q -U pip pytest
    if ($LASTEXITCODE -eq 0) {
        & $vpy -m pytest -q
        if ($LASTEXITCODE -ne 0) { Write-Error "pytest reported FAILURES on this device."; exit 1 }
    } else {
        Write-Host "  (skipped: pip/pytest unavailable here -- the selfcheck above is the gate)"
    }
} else {
    Write-Host "  (skipped: venv unavailable here -- the selfcheck above is the gate)"
}

Write-Host "============================================================"
Write-Host " RESULT: OK on $([System.Environment]::OSVersion.VersionString) / $(& $py -V 2>&1)"
Write-Host "============================================================"
