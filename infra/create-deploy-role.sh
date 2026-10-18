#!/usr/bin/env bash
# One-time: create the IAM role GitHub Actions assumes via OIDC to deploy the site.
#
# Trust: only froguin/bedrock-pricing-compare on refs/heads/main (scheduled and
#        manual runs on main). Forks, PRs and other branches cannot assume it.
# Power: PutObject on exactly s3://awskr-bedrock-pricing/index.html, and
#        CreateInvalidation on exactly the one CloudFront distribution.
# No long-lived keys; each run gets 1h credentials.
#
# Re-running is safe: an existing role gets its trust + policy refreshed.
set -euo pipefail

ROLE=gh-bedrock-compare-deploy
REPO=froguin/bedrock-pricing-compare
BUCKET=awskr-bedrock-pricing
DIST_ID=E1OQXWKSFOXAF
ACCOUNT="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
OIDC="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
# GitHub may issue "immutable" subjects (repo:owner@<id>/name@<id>:...) instead
# of repo:owner/name:... -- ask GitHub which prefix this repo's tokens carry.
SUB_PREFIX="$(gh api "repos/${REPO}/actions/oidc/customization/sub" --jq '.sub_claim_prefix // empty' 2>/dev/null || true)"
SUB_PREFIX="${SUB_PREFIX:-repo:${REPO}}"

TRUST=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"${OIDC}"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{
   "token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
   "token.actions.githubusercontent.com:sub":"${SUB_PREFIX}:ref:refs/heads/main"}}}]}
EOF
)
PERM=$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"UploadSitePage","Effect":"Allow","Action":"s3:PutObject",
  "Resource":"arn:aws:s3:::${BUCKET}/index.html"},
 {"Sid":"InvalidateSiteCache","Effect":"Allow","Action":"cloudfront:CreateInvalidation",
  "Resource":"arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}"}]}
EOF
)

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "==> role exists, refreshing trust policy"
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
else
  echo "==> create role $ROLE"
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" \
    --max-session-duration 3600 \
    --description "GitHub Actions ${REPO}@main: upload index.html + invalidate" >/dev/null
fi

echo "==> inline policy site-deploy"
aws iam put-role-policy --role-name "$ROLE" --policy-name site-deploy --policy-document "$PERM"

ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
echo "==> repo variable AWS_ROLE_ARN"
gh variable set AWS_ROLE_ARN --repo "$REPO" --body "$ARN"

echo
echo "done -> $ARN"
