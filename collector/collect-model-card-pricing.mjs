#!/usr/bin/env node
/** Model-card pricing collector.
 *
 * Some models (OpenAI GPT-5.x / GPT-6.x, Moonshot AI Kimi K3.1 Pro - Highspeed, ...) publish their
 * prices only in the "Pricing" section of their model-card page in the Bedrock user guide -- not on the aws.amazon.com pricing page and not
 * (yet) in the Price List offer files. This discovers cards from each provider's model-card index,
 * then unions them with the regional compatibility catalog so a just-launched model is collected
 * even while the compatibility page is still catching up.
 *
 * Every provider index linked from model-cards.html is read, so a new model from any provider is
 * picked up without code changes. Card prices are fill-only in merge.mjs: the pricing page and the
 * Price List always win. Narrow the run with BPC_CARD_PROVIDERS="OpenAI,Moonshot AI".
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./write-stable.mjs";
import { MODEL_CARDS_ROOT, matchProvider, parseModelCardIndex, parsePricingSection, parseProviderIndexes, parseRegionalAvailability } from "./model-card-parse.mjs";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = (process.env.BPC_CARD_PROVIDERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const docsPath = join(ROOT, "data/english-docs.json");
if (!existsSync(docsPath)) throw new Error("data/english-docs.json missing -- run collect-english-docs.mjs first");
const docs = JSON.parse(readFileSync(docsPath, "utf8"));
const knownProviders = new Set(docs.models.map((m) => m.provider));

const targetKey = (m) => `${m.provider}\u0001${String(m.model_id).toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
const indexes = [];

async function fetchText(url, attempt = 1) {
  const r = await fetch(url);
  if (r.ok) return r.text();
  if (attempt < 3 && (r.status >= 500 || r.status === 429)) {
    await new Promise((res) => setTimeout(res, 1500 * attempt));
    return fetchText(url, attempt + 1);
  }
  throw new Error(`HTTP ${r.status} ${url}`);
}

const providerIndexes = parseProviderIndexes(await fetchText(MODEL_CARDS_ROOT))
  .map((x) => ({ provider: matchProvider(x.label, knownProviders), url: x.url }))
  .filter((x) => !ONLY.length || ONLY.includes(x.provider));
// A layout change on the root page must fail the run rather than silently drop providers.
if (!ONLY.length && providerIndexes.length < 10) throw new Error(`model-cards.html listed only ${providerIndexes.length} provider indexes -- refusing to record`);
const PROVIDERS = providerIndexes.map((x) => x.provider);
const targetMap = new Map(docs.models
  .filter((m) => PROVIDERS.includes(m.provider) && /\/model-card-[^/]+\.html$/.test(m.doc_url))
  .map((m) => [targetKey(m), m]));
for (const { provider, url: indexUrl } of providerIndexes) {
  const cards = parseModelCardIndex(await fetchText(indexUrl), indexUrl, provider);
  // Small providers can have a single card; an empty index is the layout-change signal.
  if (!cards.length) throw new Error(`${provider} model-card index yielded no cards -- refusing to record`);
  indexes.push({ provider, url: indexUrl, cards: cards.length });
  for (const card of cards) targetMap.set(targetKey(card), card);
}
const targets = [...targetMap.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));
if (!targets.length) throw new Error(`no model-card pages for ${PROVIDERS.join(", ")}`);

async function fetchCard(m) {
  return fetchText(m.doc_url);
}

const out = [], problems = [], fetchFailures = [];
for (let i = 0; i < targets.length; i += 4) {
  await Promise.all(targets.slice(i, i + 4).map(async (m) => {
    try {
      const html = await fetchCard(m);
      const parsed = parsePricingSection(html);
      const regional = parseRegionalAvailability(html);
      out.push({ provider: m.provider, model_id: m.model_id, doc_url: m.doc_url,
        has_pricing_section: parsed.has_pricing, refers_to_pricing_page: parsed.refers_to_pricing_page,
        has_regional_availability: regional.has_availability, availability: regional.availability,
        rows: parsed.rows, skipped: parsed.skipped });
      for (const s of parsed.skipped) problems.push(`${m.model_id}: ${s.reason}${s.label ? ` (${s.label})` : ""}`);
      if (parsed.has_pricing && !parsed.rows.length && !parsed.refers_to_pricing_page) problems.push(`${m.model_id}: Pricing section has no parsable rows`);
    } catch (e) {
      fetchFailures.push(`${m.model_id}: ${e.message}`);
    }
  }));
}
out.sort((a, b) => a.model_id.localeCompare(b.model_id));
if (fetchFailures.length) throw new Error(`model-card fetch failed -- keeping the previous dataset\n${fetchFailures.join("\n")}`);

const priced = out.filter((m) => m.rows.length).length;
// A layout change that silently empties every card must fail the run, not erase prices.
if (priced < Math.min(3, targets.length)) {
  throw new Error(`model cards parsed ${priced}/${targets.length} with prices -- refusing to record\n${problems.join("\n")}`);
}
const doc = { generated_at: new Date().toISOString(), source: "docs.aws.amazon.com model-card pages",
  providers: PROVIDERS, indexes, models: out };
writeJsonIfChanged(join(ROOT, "data/model-card-pricing.json"), doc, 2);
console.log(`Model cards: ${priced}/${targets.length} with prices, ${out.reduce((n, m) => n + m.rows.length, 0)} rows; ${indexes.reduce((n, x) => n + x.cards, 0)} index entries`);
for (const p of problems) console.log(`  note: ${p}`);
