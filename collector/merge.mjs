#!/usr/bin/env node
/**
 * Merge sources in strict priority order:
 *   1. English AWS Pricing page literal prices
 *   2. English AWS Documentation availability/release status
 *   3. Price List offer files for SKU-level dimensions and every gap
 *
 * The page wins an exact price-key collision. Documentation decides where a
 * page-only route is available. The APIs fill keys the page does not publish.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeJsonIfChanged } from "./write-stable.mjs";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(ROOT, "data/snapshots");
const files = readdirSync(dir);
const pick = (re) => files.filter((f) => re.test(f)).sort().pop();
const read = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
const bed = JSON.parse(readFileSync(join(dir, pick(/^\d+\.json$/))));
const abfm = JSON.parse(readFileSync(join(dir, pick(/^abfm-/))));
const english = read(join(ROOT, "data/english-pricing.json"), { models: [], prices: [] });
const docs = read(join(ROOT, "data/english-docs.json"), { models: [] });
const apiPoints = [...bed.price_points, ...abfm.price_points];
const cards = read(join(ROOT, "data/model-card-pricing.json"), { models: [] });
const specialPrices = [...(bed.special_prices || []), ...(abfm.special_prices || [])];

const norm = (s) => String(s || "").toLowerCase()
  .replace(/\b(amazon|anthropic|meta|openai|xai|z ai|mistral ai|moonshot ai|nvidia)\b/g, "")
  .replace(/\b(instruct|preview)\b/g, "")
  .replace(/\.0\b/g, "")
  .replace(/[^a-z0-9]+/g, "")
  .replace(/^kimik(?=\d)/, "kimi");
const id = (provider, model) => `${provider}|${norm(model)}`;
const docsById = new Map(docs.models.map((m) => [id(m.provider, m.model_id), m]));
const apiNames = new Map();
for (const p of apiPoints) apiNames.set(id(p.provider, p.model_id), p.model_id);
const canonicalName = (provider, model) => apiNames.get(id(provider, model)) || docsById.get(id(provider, model))?.model_id || model;
const docsFor = (provider, model) => docsById.get(id(provider, model));
const apiRegions = (provider, model, endpoint) => [...new Set(apiPoints
  .filter((p) => p.provider === provider && norm(p.model_id) === norm(model) && p.endpoint_type === endpoint)
  .map((p) => p.source_region))].sort();

const pagePoints = [];
for (const p of english.prices || []) {
  const model = canonicalName(p.provider, p.model_id);
  const doc = docsFor(p.provider, model);
  let regions = p.regions || [];
  let availabilitySource = "english-pricing-page";
  if (!regions.length && doc) {
    regions = doc.availability?.[p.endpoint_type] || [];
    if (p.endpoint_type === "in-region") regions = [...new Set([...(doc.availability?.["in-region"] || []), ...(doc.availability?.["in-region-mantle"] || [])])];
    availabilitySource = "english-documentation";
  }
  if (!regions.length) {
    regions = apiRegions(p.provider, model, p.endpoint_type);
    availabilitySource = "price-list-api";
  }
  // "US CRIS" is a geo route; do not expose it from a non-US source region.
  if (p.endpoint_type === "regional-cris") regions = regions.filter((r) => r.startsWith("us-"));
  for (const region of regions) for (const [dimension, price] of [["input", p.input], ["output", p.output]]) {
    pagePoints.push({
      provider: p.provider, model_id: model, status: doc?.status || p.status || "ga",
      endpoint_type: p.endpoint_type, source_region: region,
      service_tier: p.service_tier, execution_mode: p.execution_mode,
      dimension, context_band: p.context_band || "standard", price_per_1m: price,
      raw_unit: "USD per 1M tokens", source: "english-pricing-page",
      availability_source: availabilitySource, source_url: p.source_url,
      effective_date: english.generated_at, offer_version: `english-page:${english.generated_at}`,
    });
  }
}

const key = (p) => [p.provider, norm(p.model_id), p.endpoint_type, p.source_region,
  p.service_tier, p.execution_mode, p.dimension, p.context_band || "standard"].join("|");
const pageKeys = new Set(pagePoints.map(key));
const docRegionsFor = (doc, endpoint) => endpoint === "in-region"
  ? [...new Set([...(doc?.availability?.["in-region"] || []), ...(doc?.availability?.["in-region-mantle"] || [])])]
  : (doc?.availability?.[endpoint] || []);
// Documentation is source #2: for documented models it determines release
// status and filters API-priced routes that the compatibility table does not
// advertise. Models not yet in that doc remain available via API fallback.
const documentedApi = apiPoints.flatMap((p) => {
  const doc = docsFor(p.provider, p.model_id);
  if (!doc) return [p];
  const current = docRegionsFor(doc, p.endpoint_type);
  if (current.includes(p.source_region)) return [{ ...p, status: doc.status, availability_source: "english-documentation" }];
  // The offer's UsageType does not always distinguish Geo from in-region
  // (for example Llama 3.2 and Claude Opus 4.1). Only remap an invalid
  // in-region classification to Geo when Documentation explicitly supports
  // Geo in that source region. Never remap a generic/Geo SKU to Global: doing
  // so merged Grok's $2/$6 Global rate with its $2.2/$6.6 standard rate and
  // produced a fake "two prices" range.
  if (p.endpoint_type === "in-region" && docRegionsFor(doc, "regional-cris").includes(p.source_region)) {
    return [{ ...p, endpoint_type: "regional-cris", status: doc.status,
      availability_source: "english-documentation", api_endpoint_type: p.endpoint_type }];
  }
  return [];
});
const apiByKey = new Map();
for (const p of documentedApi) {
  const k = key(p); const values = apiByKey.get(k) || new Set(); values.add(p.price_per_1m); apiByKey.set(k, values);
}
const conflicts = [];
// Model-card pricing (the "Pricing" section of each model-card page in the Bedrock user guide).
// Some models -- today the OpenAI GPT-5.x/6.x family -- publish prices only there: not on the
// pricing page and not (yet) in the offer files. A card price is a literal USD figure per
// inference option; the regions it applies to come from the compatibility table (Documentation),
// exactly like page prices without an explicit region list. Rules:
//   * fill-only: a key already published by the English pricing page or the Price List API is
//     left alone; a differing card price is reported in `model_card_conflicts`, never applied.
//   * only the Standard tier is ingested (Ultrafast rows are collected but not shown).
//   * "In-Region" rows apply to the documented in-region + bedrock-mantle regions, Geo CRIS rows
//     to documented US regional-CRIS regions, Global CRIS rows to documented global-CRIS regions.
//     An option the card does not list gets no price (nothing is inferred from the other rows).
//   * cache writes are stored as cache_write_30m and skipped for routes where the API already
//     has a cache_write_* price.
const routeKey = (p) => [p.provider, norm(p.model_id), p.endpoint_type, p.source_region,
  p.service_tier, p.execution_mode, p.context_band || "standard"].join("|");
const apiCacheWriteRoutes = new Set(documentedApi.filter((p) => /^cache_write/.test(p.dimension)).map(routeKey));
const CARD_DIMENSIONS = [["input", "input"], ["output", "output"], ["cache_read", "cache_read"], ["cache_write", "cache_write_30m"]];
const cardPoints = [], cardConflicts = [], cardKeys = new Set();
for (const m of cards.models || []) {
  const model = canonicalName(m.provider, m.model_id);
  const doc = docsFor(m.provider, model);
  for (const r of m.rows || []) {
    if (r.tier !== "standard") continue;
    let regions;
    if (r.scope === "govcloud") regions = r.endpoint === "in-region" ? r.regions : [];
    else {
      if (!doc) continue; // commercial regions come from the compatibility table
      regions = docRegionsFor(doc, r.endpoint).filter((x) => !x.startsWith("us-gov-"));
      if (r.endpoint === "regional-cris") regions = regions.filter((x) => x.startsWith("us-"));
    }
    for (const region of regions) for (const [field, dimension] of CARD_DIMENSIONS) {
      const price = r[field];
      if (price == null) continue;
      const p = {
        provider: m.provider, model_id: model, status: doc?.status || "ga",
        endpoint_type: r.endpoint, source_region: region, service_tier: "standard", execution_mode: "online",
        dimension, context_band: r.band || "standard", price_per_1m: price,
        raw_unit: "USD per 1M tokens", source: "english-model-card",
        availability_source: r.scope === "govcloud" ? "english-model-card" : "english-documentation",
        source_url: m.doc_url, effective_date: cards.generated_at, offer_version: `model-card:${cards.generated_at}`,
      };
      const k = key(p);
      if (pageKeys.has(k) || cardKeys.has(k)) continue;
      if (dimension === "cache_write_30m" && apiCacheWriteRoutes.has(routeKey(p))) continue;
      const apiValues = apiByKey.get(k);
      if (apiValues) {
        if (!apiValues.has(price)) cardConflicts.push({ key: k, model_card_price: price, api_prices: [...apiValues].sort((a, b) => a - b), source_url: m.doc_url });
        continue;
      }
      cardKeys.add(k);
      cardPoints.push(p);
    }
  }
}
for (const p of pagePoints) {
  const values = apiByKey.get(key(p));
  if (values && !values.has(p.price_per_1m)) {
    const api_prices = [...values].sort((a,b)=>a-b);
    p.source_conflict = true;
    p.api_price_per_1m = api_prices;
    conflicts.push({ key: key(p), english_price: p.price_per_1m, api_prices });
  }
}
// Page first: remove exact API keys the page publishes, then append page points.
const apiFallback = documentedApi.filter((p) => !pageKeys.has(key(p)));
const pricePoints = [...pagePoints, ...cardPoints, ...apiFallback];

const priced = new Set(pricePoints.filter((p) => /^(input|output)$/.test(p.dimension)).map((p) => id(p.provider, p.model_id)));
const allNamed = new Map();
// Only models explicitly present on the English pricing page are candidates for
// "price pending". Documentation contains image/embedding/non-token models that
// do not belong in this token-cost view; it validates launch/availability only.
for (const m of english.models || []) allNamed.set(id(m.provider, m.name), m);
const announcedModels = [...allNamed.values()].map((m) => {
  const d = docsById.get(id(m.provider, m.name));
  // The pricing page sometimes links a model to a model-card URL that does not exist (for example
  // model-card-openai-daybreak-blue.html, or the card index for GPT-6.1 Sol). The compatibility
  // table links the real card, so prefer it when both are model-card URLs and they differ.
  const url = d && /docs\.aws\.amazon\.com\/.*\/model-cards?-/.test(m.url || "") && d.doc_url !== m.url ? d.doc_url : m.url;
  return { ...m, url, pricing_available: priced.has(id(m.provider, m.name)),
    validation_source: d ? "english-documentation" : "english-pricing-page" };
}).sort((a,b)=>a.provider.localeCompare(b.provider)||a.name.localeCompare(b.name));

const merged = {
  generated_at: new Date().toISOString(),
  source_priority: ["english-pricing-page", "english-documentation", "price-list-api"],
  english_pricing_checked_at: english.generated_at || null,
  english_documentation_checked_at: docs.generated_at || null,
  offer_version: `${bed.offer_version} + ${abfm.offer_version}`,
  as_of: { AmazonBedrock: bed.offer_version, AmazonBedrockFoundationModels: abfm.offer_version },
  sources: [
    { code: "EnglishPricingPage", url: english.source, price_pairs: english.prices?.length || 0 },
    { code: "EnglishDocumentation", url: docs.source, models: docs.models?.length || 0 },
    { code: "EnglishModelCards", url: cards.source || null, models: (cards.models || []).filter((m) => m.rows?.length).length, price_points: cardPoints.length },
    { code: "AmazonBedrock", version: bed.offer_version, count: bed.count },
    { code: "AmazonBedrockFoundationModels", version: abfm.offer_version, count: abfm.count },
  ],
  regions: [...new Set(pricePoints.map((p) => p.source_region))].sort(),
  count: pricePoints.length,
  english_page_points: pagePoints.length,
  model_card_points: cardPoints.length,
  model_card_conflicts: cardConflicts,
  api_fallback_points: apiFallback.length,
  source_conflicts: conflicts,
  special_count: specialPrices.length,
  special_prices: specialPrices,
  announced_models: announcedModels,
  price_points: pricePoints,
};
const wrote = writeJsonIfChanged(join(ROOT, "web/pricing.json"), merged);
if (!wrote) console.log("web/pricing.json unchanged apart from generated_at -- kept");
console.log(`merged ${merged.count} points: English page ${pagePoints.length} first, API fallback ${apiFallback.length}; ${conflicts.length} source conflicts`);
