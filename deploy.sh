#!/usr/bin/env bash
# Deploy the single-file build to S3 + CloudFront (bedrock-compare.awskr.net).
#
# Infra is already provisioned (bucket, OAC, ACM cert, CloudFront, Route53 alias).
# This script does the two steps the agent is not permitted to run, plus the
# cache invalidation. Safe to re-run: the bucket policy is idempotent.
set -euo pipefail

BUCKET=awskr-bedrock-pricing
DIST_ID=E1OQXWKSFOXAF
ACCOUNT=090451331601
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> rebuild single-file page"
node "$ROOT/collector/build-standalone.mjs"

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

echo "==> upload"
aws s3 cp "$ROOT/dist/bedrock-pricing.html" "s3://${BUCKET}/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=300" \
  --no-progress

echo "==> invalidate edge cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" "/" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output json

echo
echo "done -> https://bedrock-compare.awskr.net"
