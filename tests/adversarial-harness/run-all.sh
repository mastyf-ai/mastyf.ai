#!/usr/bin/env bash
# Entry point — delegates to repo adversarial-harness
exec "$(cd "$(dirname "$0")/../.." && pwd)/adversarial-harness/run-all.sh" "$@"
