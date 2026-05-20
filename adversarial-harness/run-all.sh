#!/usr/bin/env bash
# Full adversarial harness — real Node proxy tests + Python policy port
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export GUARDIAN_DISABLE_SEMANTIC="${GUARDIAN_DISABLE_SEMANTIC:-true}"
LOG_DIR="${ROOT}/reports/adversarial-harness/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="${LOG_DIR}/run-${STAMP}.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== adversarial harness run-all (${STAMP}) ==="
node adversarial-harness/run-harness.mjs
echo "Log: $LOG"
