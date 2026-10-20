#!/usr/bin/env node
/**
 * Maintain a durable model lifecycle catalog and report every model/region/path
 * transition in an offer refresh. No model names are hard-coded here.
 *
 * Usage: node collector/audit-model-catalog.mjs <previous pricing.json> <new pricing.json> [catalog.json]
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const [prevPath, nextPath, catalogArg] = process.argv.slice(2);
if (!prevPath || !nextPath) {
  console.error("usage: audit-model-catalog.mjs <prev> <next> [catalog]");
  process.exit(2);
}
const CATALOG = catalogArg || join(ROOT, "data/model-catalog.json");
const prev = JSON.parse(readFileSync(prevPath, "utf8"));
const next = JSON.parse(readFileSync(nextPath, "utf8"));
const oldCatalog = existsSync(CATALOG)
  ? JSON.parse(readFileSync(CATALOG, "utf8"))
  : { schema: 1, models: {} };
const observed = Object.values(next.as_of || {}).sort().at(-1) || next.offer_version || "unknown";

const summarize = (snap) => {
  const out = new Map();
  for (const p of snap.price_points || []) {
    const key = `${p.provider}\u0001${p.model_id}`;
    let x = out.get(key);
    if (!x) {
      x = { provider: p.provider, model_id: p.model_id, statuses: new Set(), sources: new Set(), regions: new Set(), paths: new Set(), complete: new Map() };
      out.set(key, x);
    }
    x.statuses.add(p.status || "ga");
    if (p.source) x.sources.add(p.source);
    x.regions.add(p.source_region);
    x.paths.add(p.endpoint_type);
    if (/^(input|output)$/.test(p.dimension)) {
      const k = `${p.source_region}|${p.endpoint_type}|${p.execution_mode || "online"}|${p.service_tier || "standard"}|${p.context_band || "standard"}`;
      const dims = x.complete.get(k) || new Set(); dims.add(p.dimension); x.complete.set(k, dims);
    }
  }
  for (const x of out.values()) {
    x.statuses = [...x.statuses].sort();
    x.sources = [...x.sources].sort();
    x.regions = [...x.regions].sort();
    x.paths = [...x.paths].sort();
    x.complete_regions = [...new Set([...x.complete].filter(([, d]) => d.has("input") && d.has("output")).map(([k]) => k.split("|")[0]))].sort();
    delete x.complete;
  }
  return out;
};

const before = summarize(prev), after = summarize(next);
const added = [], restored = [], removed = [], changed = [];
const catalog = structuredClone(oldCatalog);
catalog.schema = 1;
catalog.models ||= {};

const arrDiff = (a = [], b = []) => a.filter((x) => !b.includes(x));
for (const [key, cur] of after) {
  const prior = before.get(key);
  const hist = catalog.models[key];
  if (!prior) (hist && hist.active === false ? restored : added).push(cur);
  if (prior) {
    const regionAdded = arrDiff(cur.regions, prior.regions), regionRemoved = arrDiff(prior.regions, cur.regions);
    const pathAdded = arrDiff(cur.paths, prior.paths), pathRemoved = arrDiff(prior.paths, cur.paths);
    const statusChanged = JSON.stringify(prior.statuses) !== JSON.stringify(cur.statuses);
    if (regionAdded.length || regionRemoved.length || pathAdded.length || pathRemoved.length || statusChanged) {
      changed.push({ ...cur, regionAdded, regionRemoved, pathAdded, pathRemoved, beforeStatus: prior.statuses });
    }
  }
  catalog.models[key] = {
    provider: cur.provider, model_id: cur.model_id, active: true,
    first_seen: hist?.first_seen || observed, last_seen: observed,
    statuses: cur.statuses, sources: cur.sources, regions: cur.regions,
    complete_regions: cur.complete_regions, paths: cur.paths,
  };
}
for (const [key, old] of before) {
  if (after.has(key)) continue;
  removed.push(old);
  const hist = catalog.models[key] || { provider: old.provider, model_id: old.model_id, first_seen: "baseline" };
  catalog.models[key] = { ...hist, active: false, removed_at: observed, last_regions: old.regions, last_paths: old.paths };
}

// Stable serialization: do not generate a commit when no catalog fact changed.
const stable = { schema: 1, as_of: next.as_of || {}, models: Object.fromEntries(Object.entries(catalog.models).sort(([a], [b]) => a.localeCompare(b))) };
const text = JSON.stringify(stable, null, 2) + "\n";
if (!existsSync(CATALOG) || readFileSync(CATALOG, "utf8") !== text) writeFileSync(CATALOG, text);

const label = (x) => `${x.provider} / ${x.model_id}`;
const lines = [
  `current ${after.size} models · +${added.length} new · +${restored.length} restored · -${removed.length} removed · ${changed.length} availability/status changed`,
  ...added.map((x) => `NEW: ${label(x)} (${x.regions.length} regions; ${x.paths.join(", ")})`),
  ...restored.map((x) => `RESTORED: ${label(x)}`),
  ...removed.map((x) => `REMOVED: ${label(x)} (was ${x.regions.length} regions)`),
  ...changed.map((x) => `CHANGED: ${label(x)}`
    + (x.regionAdded.length ? ` +regions[${x.regionAdded.join(",")}]` : "")
    + (x.regionRemoved.length ? ` -regions[${x.regionRemoved.join(",")}]` : "")
    + (x.pathAdded.length ? ` +paths[${x.pathAdded.join(",")}]` : "")
    + (x.pathRemoved.length ? ` -paths[${x.pathRemoved.join(",")}]` : "")
    + (JSON.stringify(x.beforeStatus) !== JSON.stringify(x.statuses) ? ` status[${x.beforeStatus}->${x.statuses}]` : "")),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Model catalog audit\n\n${lines.map((x) => `- ${x}`).join("\n")}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
  `models_added=${added.length}\nmodels_restored=${restored.length}\nmodels_removed=${removed.length}\nmodels_changed=${changed.length}\n`);
for (const x of removed) console.log(`::warning title=Model removed::${label(x)} disappeared from the current AWS price offers`);
