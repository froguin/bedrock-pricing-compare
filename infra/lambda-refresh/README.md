# Scheduled refresh on AWS (EventBridge + Lambda)

Replaces the GitHub Actions `schedule` cron (which GitHub drops/delays — see
`.github/workflows/refresh.yml`) with an in-account EventBridge Scheduler that
fires a Lambda on a reliable hourly cadence.

## Why this split

The scheduled job only ever changes **data**, never UI code. The dataset is
dictionary-encoded and inlined into a **vite shell** (`app/dist/index.html`) by
`collector/build-standalone.mjs`. The shell changes only when UI code changes.

So the Lambda does **not** run vite. It:

1. runs the dependency-free `collector/*.mjs` scripts (Node builtins only),
2. re-inlines the fresh dataset into the vite shell it reads from S3,
3. uploads the standalone HTML (+ brotli/gzip) to S3 and invalidates CloudFront.

UI builds stay where they are: a `push` to `main` still triggers the GitHub
Actions workflow, which runs vite and uploads a fresh shell + page.

```
EventBridge Scheduler (hourly, rate or cron)
      │
      ▼
Lambda  bedrock-pricing-refresh   (Node 22, zip, no npm deps)
  state in:  s3://$STATE_BUCKET/refresh-state/   (data/ + web/pricing.json + shell)
  1. hydrate /tmp/work from S3 state  (data/state.json, snapshots, pricing.json, shell.html)
  2. collector/check-sources.mjs      → offer/page/docs changed?  (cheap, ~20 KB)
  3. if unchanged and not forced → exit 0 (no cost beyond the HEAD requests)
  4. collect*.mjs + parse-abfm + merge → new web/pricing.json
  5. build-standalone.mjs --src shell.html → bedrock-pricing.html
  6. precompress.mjs → .br/.gz
  7. aws s3 cp page+br+gz → $SITE_BUCKET ; cloudfront create-invalidation
  8. persist updated data/ + web/pricing.json back to S3 state  (history via S3 versioning)
      │
      ▼
S3 ($SITE_BUCKET) + CloudFront   (unchanged; same bucket the site already serves)
```

## No PAT, no git

Data history is kept by **S3 versioning** on the state prefix, not by committing
back to `main`. The Lambda needs no GitHub credential. The GitHub `schedule`
cron is removed from the workflow; `push` and `workflow_dispatch` stay.

## Components

| File | Role |
|------|------|
| `infra/lambda-refresh/handler.mjs` | Lambda entry: orchestrates the steps above against `/tmp` + S3 |
| `infra/lambda-refresh/paths.mjs` | Resolves collector ROOT to `$WORK_DIR` (`/tmp/work`) in Lambda, repo root locally |
| `infra/lambda-refresh/template.yaml` | SAM/CloudFormation: Lambda + role + EventBridge Scheduler + state bucket |
| `infra/lambda-refresh/package.sh` | Zips collector/*.mjs + handler into a deployable artifact |
| `infra/lambda-refresh/seed-state.sh` | One-time: upload current data/ + web/pricing.json + vite shell to the state bucket |

## Collector ROOT change

`collector/*.mjs` currently resolve `ROOT` as the repo root (relative to the
file). In Lambda the tree is read-only, so writes must go to `/tmp`. The scripts
read an optional `BPC_ROOT` env var (falls back to repo-relative), so the Lambda
points them at `/tmp/work` without changing local/CI behaviour.

## Cost

Lambda free tier on this account is already exhausted by other workloads, so
this adds real but tiny cost: ~24 runs/day × ~30 s × (512 MB–1 GB) ≈ well under
$0.20/month. EventBridge Scheduler and S3 versioning are within always-free
limits. CloudFront invalidations: first 1,000/month free — 24/day = ~720/month.

## Status

Work-in-progress on branch `feat/scheduled-refresh-lambda`. See the per-file
headers for what is implemented.
