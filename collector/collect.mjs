#!/usr/bin/env node
/**
 * Bedrock pricing collector — baseline from the PUBLIC bulk offer files (no auth).
 * Fetches per-region offer index.json, normalizes on-demand token pricing into
 * price_point records, writes data/snapshots/<version>.json.
 *
 * Usage: node collector/collect.mjs [region ...]
 *   no args -> PoC region set. "all" -> every region in region_index.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonProvider, prettyModelId } from "./providers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock";
const POC_REGIONS = ["us-east-1", "us-west-2", "ap-northeast-2", "eu-west-1"];

// ---- non-token-model SKUs to exclude from the model comparison matrix ----
// (Data Automation, Guardrails, Prompt Router, Generate SQL, embeddings, custom import, image/doc processing)
const NON_MODEL_RE = /DataAutomation|Guardrail|Prompt-Routing|GenerateSQL|CustomModelImport|MultiModalEmbeddings|ContextualGrounding|AutomatedReasoning/i;
function isNonModelSku(attrs) {
  const u = attrs.usagetype || "";
  const f = attrs.feature || "";
  if (NON_MODEL_RE.test(u)) return true;
  if (/Data Automation|Prompt Router|Generate SQL|Custom Model Import/i.test(f)) return true;
  return false;
}

// ---- recover a model id when the `model` attribute is empty (legacy Titan etc.) ----
// Titan SKUs carry the name only in usagetype: "USE1-TitanTextG1-Lite-input-tokens".
function recoverModelId(attrs) {
  if (attrs.model) return attrs.model;
  if (attrs.titanModel) return attrs.titanModel;
  const u = attrs.usagetype || "";
  // strip leading region code (USE1-, USW2-, APNE2-, EUW1-, ...) then the trailing dimension words
  const m = u.replace(/^[A-Z0-9]{2,6}-/, "");
  const name = m
    .replace(/-(input|output|cache)[-_].*$/i, "")
    .replace(/-(input|output)-tokens.*$/i, "")
    .replace(/-ProvisionedThroughput.*$/i, "")
    .replace(/-Customization.*$/i, "");
  return name || "(unknown)";
}

// ---- provider inference for legacy (provider=undefined) SKUs ----
const ID_PREFIX_PROVIDER = {
  "xai": "xAI", "openai": "OpenAI", "google": "Google", "meta": "Meta",
  "mistral": "Mistral AI", "amazon": "Amazon", "anthropic": "Anthropic",
  "deepseek": "DeepSeek", "qwen": "Qwen", "cohere": "Cohere", "ai21": "AI21 Labs",
  "stability": "Stability AI", "writer": "Writer", "nvidia": "Nvidia",
  "moonshot": "Moonshot AI", "minimax": "Minimax AI",
};
function inferProvider(attrs) {
  if (attrs.provider) return attrs.provider;
  const model = (attrs.model || "");
  // newer SKUs put a provider-prefixed id in `model`, e.g. "xai.grok-4.6", "openai.gpt-5.4"
  const pfx = model.match(/^([a-z0-9]+)\./)?.[1];
  if (pfx && ID_PREFIX_PROVIDER[pfx]) return ID_PREFIX_PROVIDER[pfx];
  const s = `${model} ${attrs.usagetype || ""}`.toLowerCase();
  if (s.includes("claude")) return "Anthropic";
  if (s.includes("grok") || s.includes("xai")) return "xAI";
  if (s.includes("gpt") || s.includes("openai")) return "OpenAI";
  if (s.includes("nova") || s.includes("titan")) return "Amazon";
  if (s.includes("llama") || s.includes("flan")) return "Meta";
  if (s.includes("gemma") || s.includes("gemini")) return "Google";
  if (s.includes("deepseek")) return "DeepSeek";
  if (s.includes("qwen")) return "Qwen";
  if (s.includes("mistral") || s.includes("mixtral") || s.includes("pixtral") || s.includes("voxtral")) return "Mistral AI";
  if (s.includes("command") || s.includes("cohere")) return "Cohere";
  if (s.includes("jurassic") || s.includes("jamba")) return "AI21 Labs";
  if (s.includes("stable") || s.includes("sdxl")) return "Stability AI";
  return "Unknown";
}

// ---- endpoint type: AmazonBedrock encodes routing ONLY in the usagetype string ----
// e.g. "EU-Nova2.0Lite-output-tokens-cross-region-global", "...-cross-region", "...-batch"
function endpointType(attrs) {
  const t = (attrs.service_tier || "").toLowerCase();
  if (t.startsWith("global-")) return "global-cris";
  const u = (attrs.usagetype || "").toLowerCase();
  if (/cross-region-global/.test(u)) return "global-cris";
  if (/cross-region/.test(u)) return "regional-cris";
  return "in-region";
}

function serviceTier(attrs) {
  const t = (attrs.service_tier || "").toLowerCase().replace(/^global-/, "");
  if (t && t !== "batch") return t;
  const u = (attrs.usagetype || "").toLowerCase();
  const it = (attrs.inferenceType || "").toLowerCase();
  if (/priority/.test(u + it)) return "priority";
  if (/flex/.test(u + it)) return "flex";
  return "standard";
}

// ---- execution mode: batch is an async billing path, not a service tier ----
function executionMode(attrs) {
  const t = (attrs.service_tier || "").toLowerCase();
  const it = (attrs.inferenceType || "").toLowerCase();
  const u = (attrs.usagetype || "").toLowerCase();
  const f = (attrs.feature || "").toLowerCase();
  if (/batch/.test(t + it + u) || f.includes("batch") || attrs.batch === "True") return "batch";
  return "online";
}

// ---- dimension classification ----
function dimension(attrs) {
  const it = (attrs.inferenceType || "").toLowerCase();
  const tt = (attrs.tokenType || "").toLowerCase();
  const both = it + " " + tt;
  if (both.includes("cache write") || /cache-write/.test((attrs.usagetype||"").toLowerCase())) {
    return /1h|60m|hour/.test(both + " " + (attrs.usagetype||"").toLowerCase()) ? "cache_write_1h" : "cache_write_5m";
  }
  if (both.includes("cache read")) return "cache_read";
  if (it.includes("image")) return "image";
  if (it.includes("video")) return "video";
  if (it.includes("audio")) return "audio";
  // Speech tokens are priced separately from text tokens on the same model
  // (Nova Sonic: speech input $3.40 vs text input $0.06 per 1M). Keeping both
  // under "input" made two rates share one key.
  const u2 = (attrs.usagetype || "").toLowerCase();
  if (both.includes("speech") || /\bspeech-/.test(u2)) {
    return it.includes("output") || /speech-output/.test(u2) ? "speech_output" : "speech_input";
  }
  if (it.includes("output") || tt.includes("output")) return "output";
  if (it.includes("input") || tt.includes("input")) return "input";
  return null; // non-token (provisioned hour, training, storage) -> skip for PoC
}

// normalize any per-1K price to per-1M
function toPerMillion(pricePerUnit, unit) {
  const p = parseFloat(pricePerUnit);
  if (!isFinite(p)) return null;
  const u = (unit || "").toLowerCase();
  if (u.includes("1k") || u.includes("1000 tokens")) return p * 1000;
  if (u.includes("1m") || u.includes("million")) return p;
  return null; // per-image / per-minute etc -> not a token per-1M price
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
    if (isNonModelSku(a)) continue; // Data Automation / Guardrail / Router / embeddings / custom import
    // Fine-tuned ("custom model") inference is a DIFFERENT product from base
    // on-demand: same model name, same usagetype shape, different rate. Leaving
    // it in made two rates share one key (e.g. Nova 2.0 Lite input $0.33 vs $0.30).
    if (/customization/i.test(a.feature || "") || /-custom-model\b/i.test(a.usagetype || "")) continue;
    const dim = dimension(a);
    if (!dim) continue;
    // skip KiroCrew internal-model-alias contamination (not real AWS catalog SKUs)
    // Match contamination on the RAW id: prettifying drops the hyphens this
    // pattern relies on, so the order here matters.
    const rawModelId = recoverModelId(a);
    if (/-(terra|luna|sol|fable|opus-internal)\b/i.test(rawModelId) || /gpt-5\.[0-9]+-(terra|luna)/i.test(rawModelId)) continue;
    const modelId = prettyModelId(rawModelId);
    const terms = T[sku];
    if (!terms) continue;
    for (const termKey of Object.keys(terms)) {
      const pds = terms[termKey].priceDimensions || {};
      for (const pdKey of Object.keys(pds)) {
        const pd = pds[pdKey];
        const price = toPerMillion(pd.pricePerUnit?.USD, pd.unit);
        if (price == null || price === 0) continue;
        out.push({
          provider: canonProvider(inferProvider(a), modelId),
          model_id: modelId,
          status: /instant|claude 2\.|titan|^claude( \(100k\))?$/i.test(modelId) ? "legacy" : "ga",
          endpoint_type: endpointType(a),
          source_region: regionCode,
          service_tier: serviceTier(a),
          execution_mode: executionMode(a),
          dimension: dim,
          // the AmazonBedrock file has no long-context band; ABFM does
          context_band: "standard",
          price_per_1m: Number(price.toFixed(4)),
          raw_unit: pd.unit,
          source: "offer",
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
    process.stderr.write(`fetch ${rc} ...\n`);
    const offer = await fetchJson(url);
    version = offer.version;
    const rows = normalizeRegion(offer, rc);
    process.stderr.write(`  ${rc}: ${rows.length} price_points\n`);
    all = all.concat(rows);
  }

  await mkdir(join(ROOT, "data/snapshots"), { recursive: true });
  const snap = {
    generated_at: new Date().toISOString(),
    offer_version: version,
    regions,
    count: all.length,
    price_points: all,
  };
  const out = join(ROOT, "data/snapshots", `${version}.json`);
  await writeFile(out, JSON.stringify(snap, null, 2));
  // Snapshot only. The dataset the front-end loads (web/pricing.json) is written
  // by merge.mjs, which combines this with the AmazonBedrockFoundationModels
  // (Marketplace/mantle) snapshot. Writing it here would publish a single-source
  // dataset missing the newest Claude models.
  process.stderr.write(`\nwrote ${all.length} price_points -> ${out}\n`);
  process.stderr.write(`next: node collector/parse-abfm.mjs && node collector/merge.mjs\n`);

  // quick summary to stdout
  const byProv = {};
  for (const p of all) byProv[p.provider] = (byProv[p.provider] || 0) + 1;
  console.log("providers:", Object.entries(byProv).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(" | "));
}

main().catch((e) => { console.error(e); process.exit(1); });
