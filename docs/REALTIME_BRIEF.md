# Realtime data & backend decision — shared brief (measured 2026-10-18)

Goal (owner's words): show the newest Bedrock **prices** as fast as possible, and be
accurate. Owner holds that the **English AWS web pages and AWS APIs are the most
accurate sources**. News feeds (What's New) are NOT a price source — the owner rejected
them for cost monitoring. Question: how should we fetch in (near) real time, and is
staying **backend-less** the right call?

## Current system
- Site: https://bedrock-compare.awskr.net — single static HTML (530 KB, ~97 KB Brotli)
  on S3 + CloudFront (PriceClass_200, Seoul edge), cache-control max-age=300.
- Data is baked at build time: collector (Node, `collector/*.mjs`) pulls both offer
  files for 36 regions -> `merge.mjs` normalises to 17,779 price points ->
  `build-standalone.mjs` dictionary-encodes and inlines into the HTML.
  The browser does zero network calls; it only multiplies rates x monthly tokens.
- Refresh is fully manual today. No GitHub remote, no CI. The agent host cannot run
  `aws s3 cp` / `put-bucket-policy` (policy block), so deploy is a user-run `deploy.sh`.
- Owner wants to later add performance measurement (like llm-monitor.whchoi.net:
  5-minute TTFT/TPS probes) on the same domain.

## Source 1 — Price List offer files (billing ground truth)
- `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/{AmazonBedrock|AmazonBedrockFoundationModels}/index.json`
  9 KB, has `currentVersion`, ETag, Last-Modified. **CORS: `Access-Control-Allow-Origin: *`**
  (also on per-region files, e.g. us-east-1 current = 1.49 MB). Unauthenticated.
- Two offer codes needed: latest Claude etc. live only in AmazonBedrockFoundationModels
  (Marketplace / mantle SKUs).
- Measured republish cadence (AmazonBedrock, last 14 versions): 13–46 days, median ~30.
  Current AWS version 20261016210806; our data is 20261010182242 / 20261012084008 (stale).
- Covers all 36 regions, batch/online, cache TTLs, service tiers, long-context band.
- Price List Query API (GetProducts) = same data, needs SigV4 credentials.

## Source 2 — English pricing page https://aws.amazon.com/bedrock/pricing/
- 930 KB HTML, 169 `<table>` in raw HTML. **No CORS headers** (browser cannot fetch it).
- Leads the offer file: GLM 5.3 (announced 2026-10-05) has full rates on the page,
  0 rows in our offer data. GPT-6.1 Sol (2026-09-29) also absent from offer data.
- Has data the offer file lacks: **US CRIS (geo) on-demand rates** (e.g. GLM 5.3
  Global CRIS $1.68/$5.28 vs US CRIS $1.848/$5.808), dated change notices
  ("Starting October 7, 2026, cache read for Claude Sonnet 5.5 reduced 50%"),
  gated-access notes (Claude Mythos requires approval).
- Limits: Anthropic/OpenAI tables contain `{regionSelector}` placeholders — regional
  numbers are filled client-side (needs JS render or finding the JSON it loads).
  Not all 36 regions. HTML structure can change without notice.

## Constraints
- Owner prefers cheapest (current monthly cost ≈ $0). Solo project, commits straight to main.
- Public site on a .net domain: confidently-wrong numbers are the worst failure.
  Existing honesty rules: ambiguous rates shown as ranges, "계산 불가" never blanks,
  conflicting sources must be flagged, not silently picked.
- Single-file `file://`-openable build is a nice-to-have, not sacred.
- Host this agent runs on has ~3 GB free RAM; headless Chromium crashes here.
