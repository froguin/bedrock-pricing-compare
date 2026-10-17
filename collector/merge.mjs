#!/usr/bin/env node
/**
 * Merge the two source snapshots (AmazonBedrock + AmazonBedrockFoundationModels)
 * into the single normalized dataset the front-end loads.
 * Run collect.mjs and parse-abfm.mjs first.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(ROOT, "data/snapshots");
const files = readdirSync(dir);
const pick = (re) => files.filter((f) => re.test(f)).sort().pop();

const bed = JSON.parse(readFileSync(join(dir, pick(/^\d+\.json$/))));
const abfm = JSON.parse(readFileSync(join(dir, pick(/^abfm-/))));

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
  price_points: [...bed.price_points, ...abfm.price_points],
};

writeFileSync(join(ROOT, "web/pricing.json"), JSON.stringify(merged));
writeFileSync(join(ROOT, "web/src/pricing.json"), JSON.stringify(merged));
console.log(`merged ${merged.count} price_points -> web/pricing.json (${merged.regions.length} regions)`);
