#!/usr/bin/env node
/** English AWS Bedrock pricing page collector (source priority #1).
 * Extracts prices that AWS publishes as literal numbers in the HTML. Tables
 * whose cells are {priceOf!...} are deliberately left to source #3 (Price List),
 * because those placeholders resolve from the same metered offer backend.
 */
import { writeJsonIfChanged } from "./write-stable.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "https://aws.amazon.com/bedrock/pricing/";
const r = await fetch(URL);
if (!r.ok) throw new Error(`HTTP ${r.status} ${URL}`);
const html = await r.text();
const text = (s) => s.replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ").trim();
const money = (s) => { const m = String(s).replace(/,/g, "").match(/^\$\s*(\d+(?:\.\d+)?)$/); return m ? +m[1] : null; };

const PROVIDERS = {
  "ai21 labs":"AI21 Labs", "amazon nova":"Amazon", "amazon titan":"Amazon", "amazon":"Amazon",
  "anthropic":"Anthropic", "cohere":"Cohere", "deepseek":"DeepSeek", "google":"Google",
  "kims":"Moonshot AI", "kimi":"Moonshot AI", "meta":"Meta", "minimax":"MiniMax AI",
  "mistral":"Mistral AI", "nvidia":"NVIDIA", "openai":"OpenAI", "qwen":"Qwen",
  "writer":"Writer", "z ai":"Z AI",
};
const REGION_ALIASES = {
  "US East (N. Virginia)":"us-east-1", "US East (Ohio)":"us-east-2", "US West (Oregon)":"us-west-2",
  "Asia Pacific (Mumbai)":"ap-south-1", "Asia Pacific (Hyderabad)":"ap-south-2",
  "Asia Pacific (Singapore)":"ap-southeast-1", "Asia Pacific (Sydney)":"ap-southeast-2",
  "Asia Pacific (Jakarta)":"ap-southeast-3", "Asia Pacific (Tokyo)":"ap-northeast-1",
  "Asia Pacific (Seoul)":"ap-northeast-2", "Europe (Frankfurt)":"eu-central-1",
  "Europe (Ireland)":"eu-west-1", "Europe (London)":"eu-west-2", "Europe (Milan)":"eu-south-1",
  "Europe (Stockholm)":"eu-north-1", "South America (Sao Paulo)":"sa-east-1",
  "South America (São Paulo)":"sa-east-1", "AWS GovCloud (US-East and US-West)":"us-gov",
};
const providerFor = (header) => {
  const x = header.toLowerCase().replace(/\s+models?.*/, "").trim();
  return PROVIDERS[x] || null;
};
const regionsFor = (context) => {
  const i = Math.max(context.lastIndexOf("Region:"), context.lastIndexOf("Regions:"));
  if (i < 0) return [];
  const scope = context.slice(i);
  const out = [];
  for (const [name, code] of Object.entries(REGION_ALIASES)) if (scope.includes(name)) out.push(code);
  if (out.includes("us-gov")) return [...out.filter((x) => x !== "us-gov"), "us-gov-east-1", "us-gov-west-1"];
  return [...new Set(out)];
};
const tierMode = (context) => {
  const candidates = [
    ["Priority tier pricing", "priority", "online"], ["Flex tier pricing", "flex", "online"],
    ["Batch pricing", "standard", "batch"], ["Standard tier pricing", "standard", "online"],
    ["On-Demand pricing", "standard", "online"], ["On-demand pricing", "standard", "online"],
  ].map(([q, tier, mode]) => [context.lastIndexOf(q), tier, mode]).sort((a, b) => b[0] - a[0]);
  return candidates[0][0] >= 0 ? { service_tier: candidates[0][1], execution_mode: candidates[0][2] }
    : { service_tier: "standard", execution_mode: "online" };
};

const prices = [], models = new Map();
const addModel = (provider, name) => { if (provider && name) models.set(`${provider}\u0001${name}`, { provider, name, url: URL }); };
let tableCount = 0, staticTableCount = 0;
for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
  tableCount++;
  const block = match[0];
  const rows = [...block.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1])));
  if (rows.length < 2) continue;
  const header = rows[0];
  // Training/customization tables can also contain inference input/output
  // columns, but those rates apply to a trained custom model, not the base
  // on-demand model shown in this comparison.
  if (/training|train |store each|custom model/i.test(header.join(" "))) continue;
  const input = header.findIndex((x) => /^(price per 1m )?input( tokens)?$/i.test(x) || /^price per 1m input tokens$/i.test(x));
  const output = header.findIndex((x) => /^(price per 1m )?output( tokens)?$/i.test(x) || /^price per 1m output tokens$/i.test(x));
  if (input < 0 || output < 0) continue;
  const context = text(html.slice(Math.max(0, match.index - 1600), match.index));
  const first = header[0].toLowerCase();
  let provider = providerFor(header[0]);
  let fixedModel = null, rowIsRoute = /inference option/i.test(first);
  if (rowIsRoute) {
    const candidates = [...context.matchAll(/((?:GLM|Kimi)\s+(?:K)?\d+(?:\.\d+)*)/gi)];
    fixedModel = candidates.at(-1)?.[1] || null;
    provider = /^GLM/i.test(fixedModel || "") ? "Z AI" : /^Kimi/i.test(fixedModel || "") ? "Moonshot AI" : provider;
  }
  const explicitRegions = regionsFor(context);
  const tm = tierMode(context);
  let accepted = 0;
  for (const row of rows.slice(1)) {
    const iv = money(row[input]), ov = money(row[output]);
    if (iv == null || ov == null) continue;
    const model = fixedModel || row[0];
    if (!provider || !model) continue;
    addModel(provider, model);
    const route = rowIsRoute ? row[0].toLowerCase() : "";
    const endpoint_type = route.includes("global") ? "global-cris" : route.includes("us cris") ? "regional-cris"
      : /global cross-region/i.test(context.slice(-700)) ? "global-cris"
      : /geo.*cross-region/i.test(context.slice(-700)) ? "regional-cris" : "in-region";
    prices.push({ provider, model_id: model, input: iv, output: ov, endpoint_type,
      regions: explicitRegions, ...tm, context_band: "standard", status: /preview/i.test(model) ? "preview" : "ga",
      source_url: URL, table_index: tableCount - 1 });
    accepted++;
  }
  if (accepted) staticTableCount++;
}
// Explicit model-card links and pricing tabs are launch/model signals even when
// the price cells are dynamic placeholders.
for (const m of html.matchAll(/<a\b[^>]*href="([^"]*docs\.aws\.amazon\.com\/bedrock\/latest\/userguide\/model-cards?-[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const href = m[1].replace(/&amp;/g, "&");
  const provider = /openai/i.test(href) ? "OpenAI" : /xai/i.test(href) ? "xAI" : null;
  const name = text(m[2]); if (provider && name) models.set(`${provider}\u0001${name}`, { provider, name, url: href });
}
for (const m of html.matchAll(/<li\b[^>]*role="tab"[^>]*>([\s\S]*?)<\/li>/gi)) {
  const name = text(m[1]);
  if (/^GLM \d+(?:\.\d+)*(?: Flash)?$/i.test(name)) addModel("Z AI", name);
}
if (tableCount < 100 || prices.length < 100) throw new Error(`pricing page parse collapsed: ${tableCount} tables, ${prices.length} prices`);
const out = { generated_at: new Date().toISOString(), source: URL, table_count: tableCount, static_table_count: staticTableCount,
  models: [...models.values()].sort((a,b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)), prices };
writeJsonIfChanged(join(ROOT, "data/english-pricing.json"), out, 2);
console.log(`English pricing: ${tableCount} tables; ${staticTableCount} static price tables; ${prices.length} price pairs; ${models.size} named models`);
