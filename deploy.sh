#!/usr/bin/env bash
# Deploy the single-file build to S3 + CloudFront (bedrock-compare.awskr.net).
#
# Infra is already provisioned (bucket, OAC, ACM cert, CloudFront, Route53 alias).
# This script does the two steps the agent is not permitted to run, plus the
# cache invalidation. Safe to re-run: the bucket policy is idempotent.
set -euo pipefail

BUCKET=awskr-bedrock-pricing
DIST_ID=E1OQXWKSFOXAF
# Resolved from the active AWS identity so no account ID lives in the repo.
ACCOUNT="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> rebuild single-file page (Cloudscape app + inlined dataset)"
npm ci --prefix "$ROOT/app" --no-audit --no-fund
npm exec --prefix "$ROOT/app" -- vite build "$ROOT/app"
node "$ROOT/collector/build-standalone.mjs" --src app/dist/index.html --out dist/bedrock-pricing.html

echo "==> bucket policy (CloudFront-only read; one-time, idempotent)"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"AllowCloudFrontServicePrincipalReadOnly\",
    \"Effect\": \"Allow\",
    \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::${BUCKET}/*\",
    \"Condition\": {\"StringEquals\": {\"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}\"}}
  }]
}"

echo "==> upload (plain + pre-compressed; infra/cf-precompressed.js picks one)"
node "$ROOT/collector/precompress.mjs"
up() { aws s3 cp "$ROOT/$1" "s3://${BUCKET}/$2" --content-type "text/html; charset=utf-8" \
         --cache-control "public, max-age=300" --no-progress "${@:3}"; }
up dist/bedrock-pricing.html    index.html
up dist/bedrock-pricing.html.br index.html.br --content-encoding br
up dist/bedrock-pricing.html.gz index.html.gz --content-encoding gzip
aws s3 cp "$ROOT/static/robots.txt" "s3://${BUCKET}/robots.txt" --content-type "text/plain; charset=utf-8" --cache-control "public, max-age=3600" --no-progress
aws s3 cp "$ROOT/static/sitemap.xml" "s3://${BUCKET}/sitemap.xml" --content-type "application/xml; charset=utf-8" --cache-control "public, max-age=3600" --no-progress

echo "==> invalidate edge cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" "/" "/index.html.br" "/index.html.gz" "/robots.txt" "/sitemap.xml" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output json

echo
echo "done -> https://bedrock-compare.awskr.net"
