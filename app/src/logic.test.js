// node --test app/src/  — checks the ported logic against the real dataset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rank, makeMatcher, expandTiers, SIZES } from "./logic.js";

const snap = JSON.parse(readFileSync(new URL("../../web/pricing.json", import.meta.url), "utf8"));
const P = snap.price_points;
const matches = makeMatcher(P);
const base = (patch = {}) => ({
  q: "", region: "ap-northeast-2", inM: 10, outM: 2, mode: "online", resid: "any",
  statuses: new Set(["ga", "legacy"]), tiers: new Set(["standard"]), bands: new Set(["standard"]),
  vendors: new Set(P.map((p) => p.provider)), sizes: new Set(SIZES), ...patch,
});

test("Seoul default leaderboard is sorted, has a baseline and no ambiguous Haiku 5.5", () => {
  const { ranked, base: b } = rank(P, base(), matches);
  assert.ok(ranked.length > 0);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].cost.lo <= ranked[i].cost.lo);
  assert.ok(b && !b.cost.ambiguous && b.mult === 1);
  const haiku = ranked.find((r) => /haiku.*5\.5|haiku-5-5/i.test(r.model));
  if (haiku) assert.equal(haiku.cost.ambiguous, false);
});

test("strict residency only ever picks in-region", () => {
  const { ranked } = rank(P, base({ resid: "strict" }), matches);
  assert.ok(ranked.every((r) => r.path === "in-region"));
});

test("Korean alias search narrows to Sonnet", () => {
  const { ranked } = rank(P, base({ q: "소넷" }), matches);
  assert.ok(ranked.length > 0 && ranked.every((r) => /sonnet/i.test(r.model)));
});

test("expand tiers cover every priced region exactly once", () => {
  const f = base();
  const { ranked } = rank(P, f, matches);
  const r = ranked[0];
  const x = expandTiers(r, f);
  const all = x.tiers.flatMap((t) => t.regions);
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, x.nRegions);
  assert.ok(x.tiers.filter((t) => t.isMine).length <= 1);
});
