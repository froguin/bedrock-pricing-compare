#!/usr/bin/env bash
# One-time (and after every UI build): seed the refresh state bucket with the
# current data tree, the live pricing.json, and the freshly built vite shell.
# The scheduled Lambda hydrates from here.
#
# The vite shell is the ONE thing the Lambda cannot produce (it does not run
# vite). The push workflow (refresh.yml, "Sync UI shell") now uploads it on every
# main push, so this script is only needed for first-time seeding or recovery.
#
#   STATE_BUCKET=awskr-bedrock-pricing-refresh-state ./seed-state.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PREFIX="${STATE_PREFIX:-refresh-state}"
: "${STATE_BUCKET:?set STATE_BUCKET (see template.yaml output StateBucketName)}"

# Ensure the vite shell exists (produced by the UI build).
if [[ ! -f "$ROOT/app/dist/index.html" ]]; then
  echo "building vite shell (app/) ..."
  npm ci --prefix "$ROOT/app" --no-audit --no-fund
  npm exec --prefix "$ROOT/app" -- vite build "$ROOT/app"
fi

echo "==> shell.html"
aws s3 cp "$ROOT/app/dist/index.html" "s3://$STATE_BUCKET/$PREFIX/shell.html" --no-progress

echo "==> web/pricing.json"
aws s3 cp "$ROOT/web/pricing.json" "s3://$STATE_BUCKET/$PREFIX/web/pricing.json" --no-progress

echo "==> data/ subtree"
aws s3 cp "$ROOT/data" "s3://$STATE_BUCKET/$PREFIX/data" --recursive --no-progress

echo "seeded s3://$STATE_BUCKET/$PREFIX/"
