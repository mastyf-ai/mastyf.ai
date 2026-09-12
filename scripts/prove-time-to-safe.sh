#!/usr/bin/env bash
# Clean-path walk on this machine: status → self-test (no force-fail) skip if long →
# intentional block via decide → receipt visible. No SQL. No sandbox FORCE.
set -euo pipefail
BFF="${MASTYF_AI_BFF_URL:-http://127.0.0.1:4000}"
SPA="${MASTYF_SPA_URL:-http://127.0.0.1:3000}"
ok() { echo "OK  $1"; }
bad() { echo "FAIL $1"; exit 1; }

echo "BFF=$BFF SPA=$SPA"
curl -sf --max-time 5 "$BFF/api/gateway/status" >/dev/null || bad "BFF/gateway status"
ok "status"
curl -sf --max-time 5 "$BFF/api/gateway/protection" >/dev/null || bad "protection"
ok "protection"

DEC=$(curl -sS -X POST "$BFF/api/gateway/decide" -H 'Content-Type: application/json' \
  -d '{"tool_name":"tts_intentional_block","server_name":"ci-server","tool_args":{"path":"/etc/passwd"},"write_receipt":true}')
RID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('receipt_id') or '')" "$DEC")
D=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('final_decision') or '')" "$DEC")
[[ -n "$RID" ]] || bad "intentional block missing receipt"
[[ "$D" != "ALLOW" ]] || bad "intentional block was ALLOW"
ok "intentional $D receipt=$RID"

GOT=$(curl -sS "$BFF/api/gateway/receipts/$RID")
python3 -c "import json,sys; d=json.loads(sys.argv[1]); r=d.get('receipt') or d; assert (r.get('receipt_id') or r.get('request_id'))==sys.argv[2]" "$GOT" "$RID" \
  || bad "receipt not fetchable"
ok "receipt fetchable"

if curl -sf --max-time 3 "$SPA/" >/dev/null; then
  ok "SPA up $SPA"
else
  echo "SKIP SPA (not running) — Activity UI walk not observed"
fi
echo "TIME-TO-SAFE API WALK PASSED (not a fresh-Mac Gatekeeper install)"
