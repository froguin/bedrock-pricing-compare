#!/usr/bin/env bash
# Assemble the Lambda deployment tree in infra/lambda-refresh/build/:
#   build/handler.mjs      the entry point
#   build/collector/*.mjs  the dependency-free collector scripts
#
# No npm install: the collector uses only Node builtins and the handler uses
# only AWS SDK v3 modules the nodejs22.x runtime already provides.
#
#   ./package.sh   then   sam deploy --guided  (or ./deploy.sh)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"

rm -rf "$BUILD"
mkdir -p "$BUILD/collector"

cp "$HERE/handler.mjs" "$BUILD/handler.mjs"

# Only the scripts the handler actually invokes (keeps the bundle small).
for f in check-sources collect-english-pricing collect-english-docs collect \
         parse-abfm merge gate audit-model-catalog build-standalone \
         precompress providers write-stable; do
  cp "$ROOT/collector/$f.mjs" "$BUILD/collector/$f.mjs"
done

# A minimal package.json so the runtime treats .mjs as ESM and does not try to
# resolve bare "@aws-sdk/*" from node_modules (they are runtime-provided).
cat > "$BUILD/package.json" <<'JSON'
{ "name": "bedrock-pricing-refresh", "type": "module", "private": true }
JSON

echo "packaged -> $BUILD"
find "$BUILD" -type f | sed "s#$BUILD/#  #"
