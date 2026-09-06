# Mastyf Gateway Windows Installer (PowerShell)
# Usage: iex (irm https://get.mastyf.ai/win)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "         Installing Mastyf Security Gateway v0.1.0          " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python 3.10+ is required to install Mastyf Gateway."
    exit 1
}

Write-Host "[+] Installing mastyf-gateway package..." -ForegroundColor Green
pip install --upgrade --quiet mastyf-gateway

Write-Host "[+] Initializing Mastyf environment..." -ForegroundColor Green
mastyf init

Write-Host "[+] Running system diagnostics..." -ForegroundColor Green
mastyf doctor

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Installation complete! To start Mastyf Security Gateway:" -ForegroundColor Yellow
Write-Host "  mastyf start" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
