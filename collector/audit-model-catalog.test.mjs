import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./audit-model-catalog.mjs", import.meta.url);
const point = (model_id, region = "us-east-1", endpoint_type = "in-region", dimension = "input") => ({
  provider: "Test", model_id, status: "ga", source: "offer-test", source_region: region,
  endpoint_type, execution_mode: "online", service_tier: "standard", context_band: "standard",
  dimension, price_per_1m: 1,
});
const snap = (models, version) => ({ as_of: { Test: version }, offer_version: version, price_points: models.flatMap((m) => [point(m), point(m, "us-east-1", "in-region", "output")]) });

test("catalog reports model additions/removals and preserves tombstones", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-audit-"));
  const a = join(dir, "a.json"), b = join(dir, "b.json"), c = join(dir, "catalog.json");
  writeFileSync(a, JSON.stringify(snap(["A", "B"], "1")));
  writeFileSync(b, JSON.stringify(snap(["B", "C"], "2")));
  const r = spawnSync(process.execPath, [script.pathname, a, b, c], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NEW: Test \/ C/);
  assert.match(r.stdout, /REMOVED: Test \/ A/);
  const catalog = JSON.parse(readFileSync(c));
  assert.equal(catalog.models["Test\u0001A"].active, false);
  assert.equal(catalog.models["Test\u0001C"].active, true);
});

test("catalog reports a new region for an existing model", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-audit-"));
  const a = join(dir, "a.json"), b = join(dir, "b.json"), c = join(dir, "catalog.json");
  writeFileSync(a, JSON.stringify(snap(["A"], "1")));
  const next = snap(["A"], "2");
  next.price_points.push(point("A", "ap-northeast-2"), point("A", "ap-northeast-2", "in-region", "output"));
  writeFileSync(b, JSON.stringify(next));
  const r = spawnSync(process.execPath, [script.pathname, a, b, c], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CHANGED: Test \/ A \+regions\[ap-northeast-2\]/);
});
