# Redesign brief — shared context for reviewers

Premise: **assume a from-scratch rebuild.** Do not defend the current implementation.

Product: a public, Korean-language site (to be published at **awskr.net**) comparing
Amazon Bedrock model prices.

Primary persona: an engineer / ops person who wants to find what a specific model
costs, in a specific AWS region, and compare alternatives **by region and by model
size/class**. Secondary: someone budgeting a workload.

Owner's verdict on the current build, in their words: "너무 소소하게 만들어져있다"
(built too trivially) and "찾아보기 너무 힘듭니다" (too hard to find things).

## Files to read (actual files — do not guess)

- `web/index.html` — the entire current implementation. Vanilla HTML/CSS/JS, zero
  dependencies. Note the sidebar facets (model search, billing dimension, model
  status, FM vendor, parameter size, release, execution mode, service tier, compare
  regions) and the toolbar (compare-mode segment, home-region dropdown, routing
  segment, search box).
- `web/pricing.json` — the dataset. **6.4 MB: sample it, never load it whole.**
- `.shot/ui-amb.png` — current routing-comparison view (with Δ% column).
- `.shot/ui-region.png` — current region-comparison view.
- `collector/collect.mjs`, `collector/parse-abfm.mjs`, `collector/merge.mjs` — the
  two-offer-file pipeline, if you need to know where a field comes from.

## Measured data facts — design within these

- 17,793 price points · 36 regions · 138 models · unit **USD per 1M tokens**.
- Source: two public AWS offer files — `AmazonBedrock` and
  `AmazonBedrockFoundationModels` (the Marketplace/`mantle` path, where the latest
  Claude models live).
- **Routing** (`endpoint_type`): `in-region` (all regions) and `global-cris`
  (present in **all 36 regions**). Geo/regional CRIS has **no on-demand token rate
  at all** — the `_Geo` SKUs are Reserved TPM (per hour) only, so on-demand geo
  routing bills at the source region's in-region rate.
- **Dimensions**: `input`, `output`, `cache_read`, `cache_write_5m`,
  `cache_write_1h`, plus `audio`/`video`/`image` (~5% of rows).
- **status**: ga 14,938 · legacy 138 · preview 2,057 · internal 660. preview and
  internal are unreleased or internal code names and are hidden by default.
- **execution_mode**: `online` vs `batch`. Batch is roughly half price and must
  never be mixed into the same cell as online.
- **service_tier**: standard / priority / flex / latency-optimized.
- **Parameter size is parseable for only ~32% of models** — open-weight ones state
  it in the name (`Nemotron Nano 3 30B`, `Mixtral 8x7B`). Claude / Nova / GPT /
  Gemini publish nothing. A numeric parameter sort is therefore impossible for most
  rows. The current UI buckets 소형 <10B / 중형 10–70B / 대형 >70B / 파라미터 미공개,
  with the unknown bucket ON by default.
- **No model release-date field.** `effective_date` is a billing date. The current
  "출시" facet is only a version number guessed from the model name (최신 세대 4+ /
  이전 세대 3.x / 구세대 <3 / 버전 불명). A separate MCP at `whats-new.cloud/mcp`
  could later supply real release dates by joining release notes to model ids —
  treat that as a possible future input, not as available today.
- **No quality score, no tokens/sec, no latency, no context-window size** anywhere
  in the offer files.
- Price spread across models is roughly **750× to 2750×**.
- **Some cells are genuinely ambiguous**: the same (model, region, routing, tier,
  mode, dimension) key carries two different rates, because the offer file encodes
  the distinction (e.g. a context-window band) only inside the SKU. Example: Claude
  Haiku 5.5 in-region output is both `$0.55` and `$2.75`. The UI shows the lower
  value with a ⚠ marker and excludes it from Δ comparisons.

### Real insights the data already yields

- global CRIS is **9.1% cheaper** than in-region for the latest Claude models, but
  exactly **0%** for Claude Sonnet 4.
- In **ap-northeast-2 (Seoul)** the latest Claude models have **no in-region rate at
  all** — global CRIS is the only path — and its global CRIS price is **identical to
  us-east-1**.
- **Amazon Nova 2.0** via global CRIS costs about **20% more** from Seoul than from
  US regions, because global CRIS bills at the source region's rate.

## Model-name vocabulary (matters for search design)

Names are inconsistent as search targets: `Claude Sonnet 4.5`,
`Claude 3.5 Sonnet v2`, `Claude (100K)`, `xai.grok-4.6`,
`TitanEmbeddingsV2-Text-input`, `Nemotron Nano 3 30B`, `Nova 2.0 Pro`. Some are
human names, some are raw API-style ids with a provider prefix.

The audience is **Korean**. Users will type `소넷`, `sonnet`, `claude 4.5`,
`claude-3-5-sonnet`, `노바프로`, `haiku` — and will paste the API model id
(`anthropic.claude-sonnet-4-5`) straight out of their own code.

Region codes in the data are raw (`ap-northeast-2`, `us-east-1`, `eu-central-1`)
with **no human-readable names**. 36 regions is a lot for a checkbox list; the
realistic user pattern is "my own region plus the US regions".

## Competitive reality — weigh this honestly

- **https://inferplane.github.io/model-comparision/** — a peer-built site in the
  **same** Bedrock pricing niche. Already ships 5 tabs (model explore / model
  ranking / cost-vs-performance / model compare / change history), a region
  dropdown, a routing segmented control, an Artificial Analysis **intelligence
  score**, **tokens/sec** bars, a **4:1 blended price** as one comparable number,
  context window, 4 KPI cards, a `/` search hotkey, row expansion, a **compare tray
  of up to 6 models**, and explicit "미확인" markers for unknown values. Visible
  weakness: newest models are not made prominent, and it appears to show one region
  at a time.
- **https://llm-monitor.whchoi.net** — the adjacent empirical axis: live 5-minute
  probing of 66 channels (TTFT, total latency, TPS), workload preset chips,
  reliability/efficiency tabs, CSV/MD/JSON export, per-row source links, KO/EN/JA.
- Also worth studying for faceted-search craft: `openrouter.ai/models` and
  `artificialanalysis.ai` — cite what you actually observe, not generic advice.

## Prior advisory conclusion, not yet implemented

Earlier rounds concluded unanimously that a dense table is the **wrong default
landing view**, and that a **monthly-cost leaderboard driven by a workload preset**
(e.g. 10M input / 2M output tokens per month) would be the highest-leverage change.
This has **not** been built.

## Constraints to respect

- Vanilla HTML/CSS/JS, zero dependencies, is the current stack. A React/Cloudscape
  port is a deliberate **later** step — design something buildable in vanilla now.
- Korean-language UI.
- Stay honest about data gaps: **unknown is a value, never a silent blank.** A
  wrong number published confidently is the worst outcome.

## Rules for reviewers

Do not write code. Do not modify files. Report findings only.
