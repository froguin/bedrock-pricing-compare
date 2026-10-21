#!/usr/bin/env node
/** Model-card pricing collector.
 *
 * Some models (today: OpenAI GPT-5.x / GPT-6.x) publish their prices only in the "Pricing" section of
 * their model-card page in the Bedrock user guide -- not on the aws.amazon.com pricing page and not
 * (yet) in the Price List offer files. This reads each card listed in data/english-docs.json for the
 * providers in CARD_PROVIDERS and writes the parsed rows to data/model-card-pricing.json.
 * merge.mjs turns them into price points, but only where no other source has the price.
 *
 * CARD_PROVIDERS defaults to "OpenAI"; override with BPC_CARD_PROVIDERS="OpenAI,xAI".
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./write-stable.mjs";
import { parsePricingSection } from "./model-card-parse.mjs";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDERS = (process.env.BPC_CARD_PROVIDERS || "OpenAI").split(",").map((s) => s.trim()).filter(Boolean);
const docsPath = join(ROOT, "data/english-docs.json");
if (!existsSync(docsPath)) throw new Error("data/english-docs.json missing -- run collect-english-docs.mjs first");
const docs = JSON.parse(readFileSync(docsPath, "utf8"));

const targets = docs.models.filter((m) => PROVIDERS.includes(m.provider) && /\/model-card-[^/]+\.html$/.test(m.doc_url));
if (!targets.length) throw new Error(`no model-card pages for ${PROVIDERS.join(", ")} in english-docs.json`);

async function fetchCard(m, attempt = 1) {
  const r = await fetch(m.doc_url);
  if (r.ok) return r.text();
  if (attempt < 3 && (r.status >= 500 || r.status === 429)) {
    await new Promise((res) => setTimeout(res, 1500 * attempt));
    return fetchCard(m, attempt + 1);
  }
  throw new Error(`HTTP ${r.status} ${m.doc_url}`);
}

const out = [], problems = [];
for (let i = 0; i < targets.length; i += 4) {
  await Promise.all(targets.slice(i, i + 4).map(async (m) => {
    try {
      const html = await fetchCard(m);
      const parsed = parsePricingSection(html);
      out.push({ provider: m.provider, model_id: m.model_id, doc_url: m.doc_url,
        has_pricing_section: parsed.has_pricing, refers_to_pricing_page: parsed.refers_to_pricing_page,
        rows: parsed.rows, skipped: parsed.skipped });
      for (const s of parsed.skipped) problems.push(`${m.model_id}: ${s.reason}${s.label ? ` (${s.label})` : ""}`);
      if (parsed.has_pricing && !parsed.rows.length && !parsed.refers_to_pricing_page) problems.push(`${m.model_id}: Pricing section has no parsable rows`);
    } catch (e) {
      problems.push(`${m.model_id}: ${e.message}`);
    }
  }));
}
out.sort((a, b) => a.model_id.localeCompare(b.model_id));

const priced = out.filter((m) => m.rows.length).length;
// A layout change that silently empties every card must fail the run, not erase prices.
if (priced < Math.min(3, targets.length)) {
  throw new Error(`model cards parsed ${priced}/${targets.length} with prices -- refusing to record\n${problems.join("\n")}`);
}
const doc = { generated_at: new Date().toISOString(), source: "docs.aws.amazon.com model-card pages", providers: PROVIDERS, models: out };
writeJsonIfChanged(join(ROOT, "data/model-card-pricing.json"), doc, 2);
console.log(`Model cards: ${priced}/${targets.length} with prices, ${out.reduce((n, m) => n + m.rows.length, 0)} rows`);
for (const p of problems) console.log(`  note: ${p}`);
