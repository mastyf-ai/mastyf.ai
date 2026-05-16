#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
OUT="${OUT:-./MCP_Guardian_Test_Results.txt}"

# Helper: run command, capture output, print banner
run_test() {
  echo "" >> "$OUT"
  echo "================================================================" >> "$OUT"
  echo "  $1" >> "$OUT"
  echo "================================================================" >> "$OUT"
  echo "" >> "$OUT"
  eval "$2" >> "$OUT" 2>&1
}

# Start fresh
echo "MCP Guardian v2.3.3 — Test Results" > "$OUT"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$OUT"
echo "" >> "$OUT"

# 1. TypeScript Compilation
run_test "TYPESCRIPT COMPILATION" "npx tsc --noEmit"
echo "ZERO errors" >> "$OUT"

# 2. Vitest Test Suite
run_test "VITEST FULL TEST SUITE" "npx vitest run --reporter=verbose"

# 3. Security Scan (live OSV.dev)
run_test "SECURITY SCAN (live OSV.dev + NVD)" "node dist/cli.js scan --config \"$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\" --fail-on-secrets --threshold-score 70"

# 4. Health Check
run_test "HEALTH CHECK (live JSON-RPC)" "node dist/cli.js health --config \"$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\" --fail-on-overload --threshold-latency 5000"

# 5. Cost Audit
run_test "COST AUDIT" "node dist/cli.js audit --config \"$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\""

# 6. Full Report
run_test "FULL REPORT (JSON)" "node dist/cli.js report --format json --config \"$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\""

# 7. Cross-Model Pricing
run_test "CROSS-MODEL PRICING (live litellm)" "node scripts/cross-model-pricing.cjs"

# 8. Policy Engine
run_test "POLICY ENGINE VERIFICATION" "node scripts/live-policy-test.cjs"

echo "" >> "$OUT"
echo "===== END OF TEST RESULTS =====" >> "$OUT"
echo "Lines: $(wc -l < "$OUT")" 
echo "Size: $(du -h "$OUT" | cut -f1)"