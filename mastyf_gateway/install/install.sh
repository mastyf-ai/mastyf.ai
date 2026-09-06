#!/usr/bin/env bash
set -euo pipefail

# Mastyf Gateway One-Line Installer
# Usage: curl -fsSL https://get.mastyf.ai | bash

echo "============================================================"
echo "         Installing Mastyf Security Gateway v0.1.0          "
echo "============================================================"

# Check Python >= 3.10
if ! command -v python3 &>/dev/null; then
    echo "[Error] python3 is required to run Mastyf Gateway."
    exit 1
fi

PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "[+] Detected Python version: $PY_VER"

# Install package
echo "[+] Installing mastyf-gateway package..."
python3 -m pip install --upgrade --quiet mastyf-gateway || pip install -e .

# Initialize environment
echo "[+] Initializing Mastyf environment..."
mastyf init

# Run system doctor diagnostics
echo "[+] Running system diagnostics..."
mastyf doctor

echo "============================================================"
echo "Installation complete! To start Mastyf Security Gateway:"
echo "  mastyf start"
echo "============================================================"
