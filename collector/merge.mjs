#!/usr/bin/env node
/**
 * Merge the two source snapshots (AmazonBedrock + AmazonBedrockFoundationModels)
 * into the single normalized dataset the front-end loads.
 * Run collect.mjs and parse-abfm.mjs first.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeJsonIfChanged } from "./write-stable.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(ROOT, "data/snapshots");
const files = readdirSync(dir);
const pick = (re) => files.filter((f) => re.test(f)).sort().pop();

const bed = JSON.parse(readFileSync(join(dir, pick(/^\d+\.json$/))));
const abfm = JSON.parse(readFileSync(join(dir, pick(/^abfm-/))));
const pageModelsPath = join(ROOT, "data/pricing-page-models.json");
const pageModels = existsSync(pageModelsPath) ? JSON.parse(readFileSync(pageModelsPath, "utf8")) : { models: [] };
const normalizeModel = (s) => String(s).toLowerCase()
  .replace(/^(openai|xai|z ai|moonshot ai)\s+/, "")
  .replace(/[^a-z0-9]+/g, "");
const pricedModels = new Set([...bed.price_points, ...abfm.price_points]
  .map((p) => `${p.provider}|${normalizeModel(p.model_id)}`));
const announcedModels = pageModels.models.map((m) => ({
  ...m,
  pricing_available: pricedModels.has(`${m.provider}|${normalizeModel(m.name)}`),
}));

const merged = {
  generated_at: new Date().toISOString(),
  offer_version: `${bed.offer_version} + ${abfm.offer_version}`,
  as_of: {
    "AmazonBedrock": bed.offer_version,
    "AmazonBedrockFoundationModels": abfm.offer_version,
  },
  sources: [
    { code: "AmazonBedrock", version: bed.offer_version, count: bed.count },
    { code: "AmazonBedrockFoundationModels", version: abfm.offer_version, count: abfm.count },
  ],
  regions: [...new Set([...bed.regions, ...abfm.regions])].sort(),
  count: bed.count + abfm.count,
  announced_models: announcedModels,
  price_points: [...bed.price_points, ...abfm.price_points],
};

const wrote = writeJsonIfChanged(join(ROOT, "web/pricing.json"), merged);
if (!wrote) console.log("web/pricing.json unchanged apart from generated_at -- kept");
console.log(`merged ${merged.count} price_points -> web/pricing.json (${merged.regions.length} regions)`);
