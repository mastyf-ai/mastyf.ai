#!/usr/bin/env sh
# Isolated demo ledger. Does not read or rewrite ~/.mastyf/receipts.jsonl.
set -e
export MASTYF_HOME="${MASTYF_HOME:-$HOME/.mastyf-demo}"
mkdir -p "$MASTYF_HOME"
if [ -f "$HOME/.mastyf/receipts.jsonl" ] && [ "$MASTYF_HOME" = "$HOME/.mastyf" ]; then
  echo "[demo-ledger] Refusing to reuse ~/.mastyf. Unset MASTYF_HOME or use $HOME/.mastyf-demo." >&2
  exit 1
fi
echo "[demo-ledger] MASTYF_HOME=$MASTYF_HOME" >&2
echo "[demo-ledger] Fresh receipts at $MASTYF_HOME/receipts.jsonl (created on first decide)." >&2
echo "[demo-ledger] Restart the Python gateway with the same MASTYF_HOME, then: pnpm dashboard:proxy" >&2
echo "$MASTYF_HOME"
