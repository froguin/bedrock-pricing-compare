# Bedrock Pricing Dataset — Data-Quality Audit

File: `web/pricing.json` · 15,744 price_points · generated 2026-09-20T09:57:26Z
Sources: `AmazonBedrock` v20260917231609 (11,470) + `AmazonBedrockFoundationModels` v20260911124410 (4,274)

---

## P0 — blocks a trustworthy service

### P0-1. 1,198 contradictory price_points: same natural key, different price
The natural key `provider|model_id|endpoint_type|source_region|service_tier|execution_mode|dimension`
collides on **3,392 keys** (4,115 extra rows); **1,198 of those carry ≥2 different prices**.
Every one of the 1,198 has a **distinct `sku`** (1198/1198) — none differ on `raw_unit` or
`offer_version`. So these are genuinely different AWS SKUs being flattened onto one key because
the key drops the dimension the SKU encodes.

Three sub-patterns (by max/min price ratio):
- **~2.0x (718 keys)** — context-window band. e.g. `Amazon|Nova 2.0 Lite|standard|output` has
  4 prices (1.435, 1.5785, 2.87, 3.157) across 4 SKUs; `xai.grok-4.6 standard input` = 1.1 vs 2.2.
  These are almost certainly short-context vs long-context (>200K) tiers.
- **~1.1–2.5x (~380 keys)** — mixed tier/context noise, same cause.
- **100x–320x (~80 keys)** — **modality unit conflation.** `Amazon|Nova 2.0 Omni|...|image` = 0.2 vs 24
  (per-1K-token vs per-image); `Amazon|Nova Sonic|...|input` = 0.072 vs 3.7 (text vs speech tokens).
  Different billing units collapsed under one `dimension`.

Field/fix: in the merge/parser (`web/src/*`), the collision key must include the SKU's distinguishing
qualifier — parse `context_band` (e.g. `<=200K`/`>200K`) and a modality sub-type (`image_per_image`
vs `image_per_1k`, `audio`/`speech`) from the SKU `usagetype`, and add them as columns + key fields.
Until then the UI can silently show whichever of N prices lands last. **This is the headline issue.**

### P0-2. Non-GA / internal-codename / preview model_ids present (Anthropic)
These are not GA Bedrock models and will mislead any price comparison. All are `provider=Anthropic`:

| model_id | rows | why suspicious |
|---|---|---|
| `Claude Mythos 5` | 5 | internal codename, not a public model |
| `Claude Mythos 5.1` | 195 | internal codename |
| `Claude Mythos Preview` | 10 | preview + codename |
| `Claude Fable 5` | 245 | internal codename (Fable = internal alias) |
| `Claude Fable 5.1` | 205 | internal codename |
| `Claude Opus 4.6` | 350 | unreleased version number |
| `Claude Opus 4.7` | 255 | unreleased |
| `Claude Opus 4.8` | 265 | unreleased |
| `Claude Opus 5` | 371 | unreleased |
| `Claude Sonnet 5` | 265 | unreleased |
| `Claude` | 10 | bare/legacy label, no version |
| `Claude (100K)` | 4 | legacy context-suffixed label |
| `Claude Instant` / `Claude Instant (100K)` | 12 / 4 | legacy, retired |

Total suspicious Anthropic rows ≈ **2,196**. `Mythos`/`Fable` match the KiroCrew internal-alias
contamination pattern (internal codenames leaking into AWS-shaped data). `Opus 4.6/4.7/4.8/5`,
`Sonnet 5` are future/unreleased version strings.
Field/fix: add a `ga: true|false` (or `status: ga|preview|internal|legacy`) flag on each point derived
from an allowlist, and default the UI to GA-only. **Do not silently drop** — flag, so the provenance is
auditable. Verify each `model_id` against the offer file's `usagetype`/`titanModel`-equivalent before
classifying (per prior lesson: confirm in the raw listing, don't infer from the display name alone).

---

## P1 — important correctness

### P1-1. Top-level `offer_version` missing → UI renders "offer vundefined"
`index.html:77` reads `snap.offer_version`, but the snapshot has no such top-level field. It only exists
per-row (values `20260917231609` and `20260911124410`), and the top level instead has a `sources[]`
array with per-source `version`.
Field/fix: the merge step should set top-level `offer_version` (and/or the UI should read
`snap.sources.map(s=>s.version).join(' / ')`). Since two offer files are merged, a single scalar is
ambiguous — prefer showing both, e.g. `AmazonBedrock 20260917231609 / ABFM 20260911124410`.

### P1-2. `service_tier` has undeclared value `latency-optimized` (12 rows)
Schema declares `[standard/priority/flex/batch]`, but the data contains `latency-optimized` (12 rows,
all `Anthropic/Claude 3.5 Haiku`) and **no `batch` tier at all** — batch is modeled via
`execution_mode=batch` (2,208 rows) instead. So the schema doc and the data disagree on both ends.
Field/fix: reconcile the schema — either fold `latency-optimized` into a documented enum (it's a real
Bedrock mode) or map it, and remove `batch` from the `service_tier` enum since it lives in
`execution_mode`.

### P1-3. `provider="Unknown"` (57 rows) — parser provider-inference gap
`Palmyra X4` (8) + `Palmyra X5` (8) are Writer models (the dataset already has a `Writer` provider);
`TwelveLabs Pegasus 1.2` (41) is TwelveLabs. These are real models the `inferProvider` step failed to
attribute — same class of bug as the `xai.`/`openai.` prefix miss below.
Field/fix: extend provider inference to map `Palmyra*`→Writer, `TwelveLabs*`→TwelveLabs.

### P1-4. Raw provider-prefixed model_ids not normalized (6 model_ids)
`xai.grok-4.6` (648), `xai.grok-4.3` (60), `openai.gpt-5.4` (6), `google.gemma-4-31b` (40),
`google.gemma-4-26b-a4b` (40), `google.gemma-4-e2b` (39) keep their raw `provider.id` form while
sibling models get clean display names (`GPT OSS`, `Gemma 3 12B`). Cosmetic + a comparison hazard
(same model could appear twice under two spellings).
NOTE per prior lesson: `openai.gpt-5.4` and any `openai.gpt-5.6`/`terra`/`luna`-style ids must be
**verified against the raw offer file** before trusting — internal model aliases have contaminated
AWS-shaped data before. Confirm these six are genuinely in the offer SKUs, not alias leakage.
Field/fix: run these through the same display-name normalizer the other models use.

### P1-5. Provider label fragmentation
`Mistral` (1,284) and `Mistral AI` (208) are the same vendor split across two labels (the 208 are all
`Devstral`). Breaks any per-provider grouping/filter.
Field/fix: canonicalize to one label.

---

## P2 — nice-to-have

### P2-1. `regional-cris` declared but never populated
Schema lists `endpoint_type ∈ {in-region, global-cris, regional-cris}` but the data has only
`in-region` (12,611) and `global-cris` (3,133) — **zero `regional-cris`**. Either the offer files
genuinely have no regional-CRIS SKUs, or the parser isn't matching them.
Field/fix: confirm against the raw offer file whether regional-CRIS usagetypes exist; if they don't,
drop the value from the schema doc so the UI doesn't offer an always-empty filter. If they do, it's a
parser miss (promote to P1).

### P2-2. No `price=0`, null, negative, NaN, or >1000 values
Checked — **clean** (0 of each). No action; noted for completeness so the "absurd values" question is
closed. (The 100x–320x cases in P0-1 are real per-image/speech prices, not absurd scalars — they're a
key/unit problem, not a value problem.)

---

## One-line summary
The dataset has no bad scalars, but **1,198 rows silently contradict each other** because the row key
drops the SKU's context/modality qualifier (P0-1), and **~2,200 Anthropic rows are non-GA codenames**
(Mythos/Fable/Opus 4.6-5/Sonnet 5) with no GA flag to hide them (P0-2). Fix those two before trusting
any comparison; the `offer vundefined` header (P1-1) is a one-line UI/merge fix.
