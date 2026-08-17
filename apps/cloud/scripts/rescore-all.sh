#!/usr/bin/env bash
# Force rescore all packages in batches using the worker.
# Runs until no more packages need rescoring.

set -e
export DATABASE_URL="postgresql://neondb_owner:npg_BOmH08yXDgse@ep-wispy-mouse-aznn5raj-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

BATCH=100
TOTAL=0
ITERATION=0

# Refresh all TTLs before starting so certified page sees everything
psql "$DATABASE_URL" -c "UPDATE package_score_cache SET expires_at = NOW() + INTERVAL '24 hours' WHERE expires_at < NOW();" > /dev/null 2>&1 || true

while true; do
  ITERATION=$((ITERATION + 1))
  echo "=== Rescore iteration ${ITERATION} (batch ${BATCH}) ==="
  
  RESULT=$(FORCE_RESCORE=true BATCH_SIZE=$BATCH node /Users/rudraneeldas/Projects/mastyf.ai/apps/cloud/scripts/package-score-worker.mjs 2>&1)
  
  # Count successes from output
  SUCCESS_COUNT=$(echo "$RESULT" | grep -c "✓" || true)
  TOTAL=$((TOTAL + SUCCESS_COUNT))
  
  echo "$RESULT" | tail -3
  echo "Running total: ${TOTAL} packages scored"
  
  # If no successes, we're done
  if [ "$SUCCESS_COUNT" -eq 0 ]; then
    echo "No more packages to score. Done."
    break
  fi
  
  # Refresh TTLs every 10 batches so early packages don't expire mid-run
  if [ $((ITERATION % 10)) -eq 0 ]; then
    psql "$DATABASE_URL" -c "UPDATE package_score_cache SET expires_at = NOW() + INTERVAL '24 hours' WHERE expires_at < NOW();" > /dev/null 2>&1 || true
    echo "TTLs refreshed."
  fi
  
  # Small delay between batches
  sleep 2
done

echo ""
echo "========================================="
echo "FINAL: ${TOTAL} packages rescored"
echo "========================================="
