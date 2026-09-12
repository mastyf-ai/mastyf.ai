#!/usr/bin/env bash
# Prove allow_once: first matching decide is ALLOW, second matching decide is denied.
# Uses a NEW unique tool name. Does not touch smoke-p7 receipts.
set -euo pipefail
BFF="${MASTYF_AI_BFF_URL:-http://127.0.0.1:4000}"
TOOL="allow_once_next_$(date +%s)"
fail=0
ok() { echo "OK  $1"; }
bad() { echo "FAIL $1"; fail=1; }

echo "BFF=$BFF tool=$TOOL"
curl -sf --max-time 5 "$BFF/api/gateway/status" >/dev/null || { bad "BFF down"; exit 1; }

DEC1=$(curl -sS -X POST "$BFF/api/gateway/decide" -H 'Content-Type: application/json' \
  -d "{\"tool_name\":\"$TOOL\",\"server_name\":\"ci-server\",\"tool_args\":{\"probe\":true},\"write_receipt\":true}")
RID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('receipt_id') or '')" "$DEC1")
D1=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('final_decision') or '')" "$DEC1")
if [[ -z "$RID" ]]; then bad "first decide missing receipt_id"; echo "$DEC1" | head -c 300; exit 1; fi
ok "first decide $D1 receipt=$RID"
if [[ "$D1" == "ALLOW" ]]; then bad "first decide must not be ALLOW (nothing to grant)"; exit 1; fi

ALLOW=$(curl -sS -X POST "$BFF/api/gateway/escalation/resolve" -H 'Content-Type: application/json' \
  -d "{\"receipt_id\":\"$RID\",\"action\":\"allow_once\",\"confirmation\":true,\"ttl_seconds\":3600}")
GRANT=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print((d.get('grant') or {}).get('grant_id') or d.get('grant_id') or '')" "$ALLOW")
if [[ -z "$GRANT" ]]; then bad "allow_once missing grant_id"; echo "$ALLOW" | head -c 400; exit 1; fi
ok "allow_once grant=$GRANT ttl=3600"

DEC2=$(curl -sS -X POST "$BFF/api/gateway/decide" -H 'Content-Type: application/json' \
  -d "{\"tool_name\":\"$TOOL\",\"server_name\":\"ci-server\",\"tool_args\":{\"probe\":true},\"write_receipt\":true}")
D2=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('final_decision') or '')" "$DEC2")
R2=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('reason_code') or '')" "$DEC2")
if [[ "$D2" != "ALLOW" ]]; then bad "second decide should be ALLOW via grant (got $D2 $R2)"; echo "$DEC2" | head -c 400; fail=1
else ok "second decide ALLOW reason=$R2 (grant consumed)"; fi

DEC3=$(curl -sS -X POST "$BFF/api/gateway/decide" -H 'Content-Type: application/json' \
  -d "{\"tool_name\":\"$TOOL\",\"server_name\":\"ci-server\",\"tool_args\":{\"probe\":true},\"write_receipt\":true}")
D3=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('final_decision') or '')" "$DEC3")
if [[ "$D3" == "ALLOW" ]]; then bad "third decide must not be ALLOW (grant was single-use, got $D3)"; fail=1
else ok "third decide $D3 (grant exhausted)"; fi

if [[ "$fail" -ne 0 ]]; then echo "ALLOW-ONCE NEXT-CALL PROOF FAILED"; exit 1; fi
echo "ALLOW-ONCE NEXT-CALL PROOF PASSED"
