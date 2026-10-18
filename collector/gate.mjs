#!/usr/bin/env node
/**
 * Publish gate: compare a freshly merged dataset against the one currently
 * live, and exit non-zero (blocking the deploy) if it looks broken.
 *
 * Usage: node collector/gate.mjs <previous pricing.json> <new pricing.json>
 *
 * Fails on:
 *   - fewer regions than before
 *   - more than 20% of price points gone
 *   - any price <= 0 or non-finite
 *   - any matching price key that moved more than 10x either way
 */
import { readFileSync, appendFileSync } from "node:fs";

const [prevPath, nextPath] = process.argv.slice(2);
if (!prevPath || !nextPath) { console.error("usage: gate.mjs <prev> <next>"); process.exit(2); }
const prev = JSON.parse(readFileSync(prevPath, "utf8"));
const next = JSON.parse(readFileSync(nextPath, "utf8"));

const key = (p) => [p.provider, p.model_id, p.endpoint_type, p.source_region, p.service_tier,
  p.execution_mode, p.dimension, p.context_band].join("|");
// Some keys legitimately carry several rates (Nova 2.0 Omni image SKUs, two
// Qwen3 Next SKUs in ap-south-1). Last-write-wins would compare whichever rate
// happened to come last, and AWS reorders SKUs between versions -- that reads as
// a fake 100x jump. Keep the whole set and only ratio-check single-rate keys.
const index = (snap) => {
  const m = new Map();
  for (const p of snap.price_points) {
    const s = m.get(key(p)) || new Set();
    s.add(p.price_per_1m);
    m.set(key(p), s);
  }
  return m;
};

const fails = [];
if (next.regions.length < prev.regions.length) {
  fails.push(`regions dropped ${prev.regions.length} -> ${next.regions.length}`);
}
if (next.count < prev.count * 0.8) {
  fails.push(`price points dropped ${prev.count} -> ${next.count} (>20%)`);
}
const bad = next.price_points.filter((p) => !Number.isFinite(p.price_per_1m) || p.price_per_1m <= 0);
if (bad.length) fails.push(`${bad.length} non-positive/non-finite prices, e.g. ${key(bad[0])}`);

const a = index(prev), b = index(next);
const jumps = [];
for (const [k, vs] of b) {
  const olds = a.get(k);
  if (!olds || olds.size !== 1 || vs.size !== 1) continue;
  const [old] = olds, [v] = vs;
  if (v / old > 10 || old / v > 10) jumps.push(`${k}: ${old} -> ${v}`);
}
if (jumps.length) fails.push(`${jumps.length} prices moved >10x, e.g. ${jumps.slice(0, 3).join("; ")}`);

const added = [...b.keys()].filter((k) => !a.has(k)).length;
const removed = [...a.keys()].filter((k) => !b.has(k)).length;
const summary = `prev ${prev.count} pts / ${prev.regions.length} regions -> next ${next.count} pts / ${next.regions.length} regions` +
  ` (+${added} keys, -${removed} keys)`;

const report = fails.length ? `GATE FAILED: ${summary}\n` + fails.map((f) => `- ${f}`).join("\n") : `gate passed: ${summary}`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Publish gate\n\n${report}\n`);
process.exit(fails.length ? 1 : 0);
