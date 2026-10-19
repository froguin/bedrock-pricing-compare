#!/usr/bin/env node
/**
 * ABFM parser — AmazonBedrockFoundationModels offer file (the AWS Marketplace /
 * "Amazon Bedrock Edition" pricing path where MODERN Claude and other
 * marketplace-billed FMs live). This file's schema differs from AmazonBedrock:
 *   - provider attribute is BLANK  -> derive from `servicename`
 *   - service_tier / tokenType attributes are ABSENT -> everything is encoded
 *     in usagetype, e.g. "USE1-MP:USE1_cache_write_tokens_1h_global_standard-Units"
 *
 * Two usagetype naming conventions coexist (verified against the live file):
 *   new  snake_case : input_tokens_global_standard, cache_read_tokens_global_standard,
 *                     cache_write_tokens_1h_global_standard, output_tokens_standard
 *   old  CamelCase  : InputTokenCount_Global, OutputTokenCount_Batch,
 *                     CacheReadInputTokenCount_LatencyOptimized, CacheWrite1hInputTokenCount
 *
 * Emits the same price_point schema as collector/collect.mjs so snapshots merge.
 *
 * Usage: node collector/parse-abfm.mjs [region ...]   (default: PoC set; "all" = every region)
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { writeJsonIfChanged } from "./write-stable.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonProvider } from "./providers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels";
const POC_REGIONS = ["us-east-1", "us-west-2", "ap-northeast-2", "eu-west-1"];

// ---- provider from "Claude Sonnet 4.5 (Amazon Bedrock Edition)" ----
function providerFromServiceName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("claude")) return "Anthropic";
  if (n.includes("nova") || n.includes("titan")) return "Amazon";
  if (n.includes("llama")) return "Meta";
  if (n.includes("mistral") || n.includes("mixtral") || n.includes("pixtral")) return "Mistral AI";
  if (n.includes("command") || n.includes("cohere") || n.includes("embed")) return "Cohere";
  if (n.includes("jamba") || n.includes("jurassic")) return "AI21 Labs";
  if (n.includes("gpt") || n.includes("openai")) return "OpenAI";
  if (n.includes("grok") || n.includes("xai")) return "xAI";
  if (n.includes("gemma") || n.includes("gemini")) return "Google";
  if (n.includes("deepseek")) return "DeepSeek";
  if (n.includes("qwen")) return "Qwen";
  if (n.includes("stability") || n.includes("stable")) return "Stability AI";
  return "Unknown";
}

// clean the model name: drop the "(Amazon Bedrock Edition)" suffix
function cleanModelId(servicename) {
  return (servicename || "(unknown)").replace(/\s*\(Amazon Bedrock Edition\)\s*$/i, "").trim() || "(unknown)";
}

// ---- lifecycle status: keep GA visible by default, flag only explicit evidence ----
// Do NOT infer "future/unreleased" from a model version. That rule became stale
// when Claude 5 launched and hid valid, billable Seoul in-region SKUs. A priced
// offer is GA unless AWS names it Preview; internal aliases remain flagged.
function modelStatus(modelId) {
  const m = modelId.toLowerCase();
  if (/\b(mythos|fable)\b/.test(m)) return "internal";          // internal aliases, not real model names
  if (/preview/.test(m)) return "preview";
  if (/^claude( \(100k\))?$/.test(m) || /instant/.test(m) || /claude 2\./.test(m)) return "legacy";
  return "ga";
}

// ---- decode usagetype ----
// returns {dimension, tier, endpoint} or null if not an on-demand token price
function decodeUsageType(u) {
  const s = u || "";
  // strip "USE1-MP:USE1_" region wrapper + trailing "-Units"
  const core = s.replace(/^[A-Z0-9]+-MP:[A-Z0-9]+_/, "").replace(/-Units$/, "");

  // reject non-token / non-on-demand SKUs
  if (/ProvisionedThroughput|Reserved_|Customization|ModelStorage|CustomModel|Created_image|InputImageCount|Cohere_Embed/i.test(core)) {
    return null;
  }
  if (/^MillionBatch(Input|Output)Tokens$/i.test(core)) {
    // batch token pricing in the "Million...Tokens" form
    return { dimension: /Input/i.test(core) ? "input" : "output", tier: "standard", mode: "batch", endpoint: "in-region", context_band: "standard" };
  }

  // dimension
  let dimension;
  if (/cache[_ ]?read/i.test(core) || /CacheReadInputToken/i.test(core)) dimension = "cache_read";
  else if (/cache[_ ]?write/i.test(core) || /CacheWrite/i.test(core)) {
    // TTL matters: 1h cache-write is priced separately from the default 5m
    dimension = /(_1h_|Write1h)/i.test(core) ? "cache_write_1h" : "cache_write_5m";
  }
  else if (/output[_ ]?token/i.test(core) || /OutputTokenCount/i.test(core)) dimension = "output";
  else if (/input[_ ]?token/i.test(core) || /InputTokenCount/i.test(core)) dimension = "input";
  else if (/video/i.test(core)) dimension = "video";
  else if (/audio/i.test(core)) dimension = "audio";
  else if (/image/i.test(core)) dimension = "image";
  else return null; // unknown token shape -> skip

  // endpoint: Global -> global-cris ; Geo -> regional-cris ; else in-region
  const endpoint = /(_|^)global(_|$)/i.test(core) || /_Global\b/i.test(core) ? "global-cris"
                 : /_Geo\b/i.test(core) ? "regional-cris" : "in-region";

  // tier: LatencyOptimized / standard  (Priority/Flex not present in this file)
  const tier = /LatencyOptimized/i.test(core) ? "latency-optimized" : "standard";
  // execution mode: batch vs online (async batch is a separate billing path)
  const mode = /batch/i.test(core) ? "batch" : "online";
  // CONTEXT BAND: some models price a long-context band separately, encoded only
  // here (e.g. input_tokens_long_ctx_standard). Without this axis two different
  // rates collided on one key: Claude Haiku 5.5 input $0.11 (standard) vs $0.55
  // (long ctx), GPT-6 Astra output $55 vs $82.50.
  const context_band = /_long_ctx_|LongContext/i.test(core) ? "long-ctx" : "standard";

  return { dimension, tier, mode, endpoint, context_band };
}

function toPerMillion(pricePerUnit, unit) {
  const p = parseFloat(pricePerUnit);
  if (!isFinite(p)) return null;
  const un = (unit || "").toLowerCase();
  if (un.includes("1m") || un.includes("million") || un.includes("1m tokens")) return p;
  if (un.includes("1k") || un.includes("1000 tokens")) return p * 1000;
  return null;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function normalizeRegion(offer, regionCode) {
  const out = [];
  const P = offer.products, T = offer.terms?.OnDemand || {};
  for (const sku of Object.keys(P)) {
    const a = P[sku].attributes || {};
    const decoded = decodeUsageType(a.usagetype);
    if (!decoded) continue;
    const terms = T[sku];
    if (!terms) continue;
    const modelId = cleanModelId(a.servicename);
    const provider = canonProvider(providerFromServiceName(a.servicename), modelId);
    const status = modelStatus(modelId);
    for (const termKey of Object.keys(terms)) {
      const pds = terms[termKey].priceDimensions || {};
      for (const pdKey of Object.keys(pds)) {
        const pd = pds[pdKey];
        const price = toPerMillion(pd.pricePerUnit?.USD, pd.unit);
        if (price == null) continue; // keep 0.0 out? cache/beta can legitimately be >0; skip null only
        out.push({
          provider,
          model_id: modelId,
          status,
          endpoint_type: decoded.endpoint,
          source_region: regionCode,
          service_tier: decoded.tier,
          execution_mode: decoded.mode,
          dimension: decoded.dimension,
          context_band: decoded.context_band,
          price_per_1m: Number(price.toFixed(4)),
          raw_unit: pd.unit,
          raw_usagetype: a.usagetype,
          source: "offer-abfm",
          sku: sku,
          effective_date: terms[termKey].effectiveDate,
          offer_version: offer.version,
        });
      }
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = await fetchJson(`${BASE}/current/region_index.json`);
  let regions = args.length === 0 ? POC_REGIONS
    : args[0] === "all" ? Object.keys(idx.regions)
    : args;
  regions = regions.filter((r) => idx.regions[r]);

  let all = [], version = null;
  for (const rc of regions) {
    const url = "https://pricing.us-east-1.amazonaws.com" + idx.regions[rc].currentVersionUrl;
    process.stderr.write(`fetch ABFM ${rc} ...\n`);
    const offer = await fetchJson(url);
    version = offer.version;
    const rows = normalizeRegion(offer, rc);
    process.stderr.write(`  ${rc}: ${rows.length} price_points\n`);
    all = all.concat(rows);
  }

  await mkdir(join(ROOT, "data/snapshots"), { recursive: true });
  const out = join(ROOT, "data/snapshots", `abfm-${version}.json`);
  if (!writeJsonIfChanged(out, {
    generated_at: new Date().toISOString(),
    offer_version: version, regions, count: all.length, source: "AmazonBedrockFoundationModels",
    price_points: all,
  }, 2)) process.stderr.write(`unchanged, kept ${out}\n`);
  process.stderr.write(`\nwrote ${all.length} ABFM price_points -> ${out}\n`);

  // summary
  const byProv = {}, byEp = {}, byDim = {};
  for (const p of all) { byProv[p.provider]=(byProv[p.provider]||0)+1; byEp[p.endpoint_type]=(byEp[p.endpoint_type]||0)+1; byDim[p.dimension]=(byDim[p.dimension]||0)+1; }
  const top=(o)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(" | ");
  console.log("providers:", top(byProv));
  console.log("endpoint :", top(byEp));
  console.log("dimension:", top(byDim));
  // show Claude models recovered
  const claude=[...new Set(all.filter(p=>p.provider==="Anthropic").map(p=>p.model_id))].sort();
  console.log("Anthropic models recovered ("+claude.length+"):", claude.join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
