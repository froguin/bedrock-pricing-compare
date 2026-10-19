// node --test app/src/  — checks the ported logic against the real dataset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rank, makeMatcher, expandTiers, rankEmbeddings, groupVideoPrices, isEmbeddingModel, SIZES } from "./logic.js";

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


test("embedding models are excluded from chat ranking and calculated input-only", () => {
  const f = base();
  const normal = rank(P, f, matches);
  assert.ok(normal.ranked.every((x) => !isEmbeddingModel(x.model)));
  assert.ok(normal.partial.every((x) => !isEmbeddingModel(x.model)));
  const embeddings = rankEmbeddings(P, f, matches);
  assert.ok(embeddings.some((x) => x.model === "TitanEmbeddingsV2-Text-input" && x.costLo === 0.246));
  assert.ok(embeddings.some((x) => x.model === "Cohere Embed 4 Model" && x.costLo === 1.2));
});

test("video generation rates stay per-second and group regions without duplicates", () => {
  const rows = groupVideoPrices(snap.special_prices);
  assert.ok(rows.some((x) => x.model === "Nova Reel" && x.rate === 0.08 && x.regions.includes("us-east-1")));
  assert.ok(rows.some((x) => x.model === "Luma Ray2" && x.rate === 0.75 && /Standard/.test(x.variant)));
  assert.ok(rows.every((x) => x.regions.length === new Set(x.regions).size));
});


test("Opus 5 exposes Seoul in-region alternative when cheapest path is Global", () => {
  const any = base({ q: "Claude Opus 5", resid: "any" });
  const opus = rank(P, any, matches).ranked.find((x) => x.model === "Claude Opus 5");
  assert.equal(opus.path, "global-cris");
  assert.equal(opus.cost.lo, 100);
  assert.equal(opus.cheaperPathIsNonInRegion, true);
  assert.equal(opus.inRegionCost.lo, 110);
  const tiers = expandTiers(opus, any).tiers;
  assert.ok(tiers.some((x) => x.isChosen && x.path === "global-cris" && x.c.lo === 100));
  assert.ok(tiers.some((x) => x.isMine && !x.isChosen && x.path === "in-region" && x.c.lo === 110 && x.delta === 10));

  const strict = base({ q: "Claude Opus 5", resid: "strict" });
  const strictOpus = rank(P, strict, matches).ranked.find((x) => x.model === "Claude Opus 5");
  assert.equal(strictOpus.path, "in-region");
  assert.equal(strictOpus.cost.lo, 110);
  assert.equal(strictOpus.cheaperPathIsNonInRegion, false);
});
