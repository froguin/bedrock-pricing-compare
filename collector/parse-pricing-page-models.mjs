#!/usr/bin/env node
/** Extract model names explicitly published on the English Bedrock pricing page.
 * This is a discovery signal, not a price source. Models absent from both AWS
 * offer files are shown as "price file pending" and never assigned a guessed rate.
 */
import { writeJsonIfChanged } from "./write-stable.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "https://aws.amazon.com/bedrock/pricing/";
const r = await fetch(URL);
if (!r.ok) throw new Error(`HTTP ${r.status} ${URL}`);
const html = await r.text();
const decode = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const found = new Map();
const add = (provider, name, url = URL) => {
  name = decode(name);
  if (name && provider) found.set(`${provider}\u0001${name}`, { provider, name, url });
};

// Model-card links are explicit model declarations and include a stable doc URL.
for (const m of html.matchAll(/<a\b[^>]*href="([^"]*docs\.aws\.amazon\.com\/bedrock\/latest\/userguide\/model-cards?-[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const href = m[1].replace(/&amp;/g, "&");
  const provider = /openai/i.test(href) ? "OpenAI" : /xai/i.test(href) ? "xAI" : null;
  add(provider, m[2], href);
}

// A few providers publish model versions as pricing tabs rather than model-card links.
for (const m of html.matchAll(/<li\b[^>]*role="tab"[^>]*>([\s\S]*?)<\/li>/gi)) {
  const name = decode(m[1]);
  if (/^GLM \d+(?:\.\d+)*(?: Flash)?$/i.test(name)) add("Z AI", name);
}
if (found.size < 5) throw new Error(`pricing page yielded only ${found.size} explicit model names -- refusing to record`);
const out = { generated_at: new Date().toISOString(), source: URL, models: [...found.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)) };
writeJsonIfChanged(join(ROOT, "data/pricing-page-models.json"), out, 2);
console.log(`pricing page: ${out.models.length} explicitly named models`);
