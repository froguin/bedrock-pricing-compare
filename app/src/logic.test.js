// node --test app/src/  — checks the ported logic against the real dataset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rank, makeMatcher, expandTiers, rankEmbeddings, rankSpeech, groupVideoPrices, isEmbeddingModel, relativeKo, SIZES } from "./logic.js";

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


test("embedding models are excluded from chat ranking and filtered by selected region", () => {
  const f = base();
  const normal = rank(P, f, matches);
  assert.ok(normal.ranked.every((x) => !isEmbeddingModel(x.model)));
  assert.ok(normal.partial.every((x) => !isEmbeddingModel(x.model)));
  const { ranked, missing } = rankEmbeddings(P, f, matches);
  assert.ok(ranked.some((x) => x.model === "TitanEmbeddingsV2-Text-input" && x.costLo === 0.246));
  assert.ok(ranked.some((x) => x.model === "Cohere Embed 4 Model" && x.costLo === 1.2));
  assert.ok(ranked.every((x) => x.regions[f.region]));
  assert.ok(missing.some((x) => x.model === "Titan Embeddings G1 Text"));
  assert.ok(missing.every((x) => !ranked.some((r) => r.key === x.key)));
});

test("video generation shows only variants supported in the selected region", () => {
  const seoul = groupVideoPrices(snap.special_prices, "ap-northeast-2");
  assert.equal(seoul.ranked.length, 0);
  assert.ok(seoul.missing.every((x) => !x.regions.includes("ap-northeast-2")));

  const tokyo = groupVideoPrices(snap.special_prices, "ap-northeast-1");
  assert.equal(tokyo.ranked.length, 2);
  assert.ok(tokyo.ranked.every((x) => x.model === "Nova Reel" && x.rate === 0.08 && x.regions.includes("ap-northeast-1")));
  assert.ok(tokyo.missing.some((x) => x.model === "Luma Ray2" && x.rate === 0.75 && /Standard/.test(x.variant)));
  assert.ok(tokyo.ranked.every((x) => x.regions.length === new Set(x.regions).size));
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

test("speech models leave the token ranking and are costed on speech tokens", () => {
  const f = base({ region: "us-east-1" });
  const isSonic = (m) => /sonic/i.test(m);
  const normal = rank(P, f, matches);
  assert.ok(normal.ranked.every((x) => !isSonic(x.model)));
  assert.ok(normal.partial.every((x) => !isSonic(x.model)));
  assert.ok(normal.missing.every((x) => !isSonic(x.model)));
  const { ranked, missing } = rankSpeech(P, f, matches, 10, 2);
  const get = (m) => ranked.find((x) => x.model === m);
  // 10M speech in + 2M speech out: Nova Sonic 3.4*10 + 13.6*2, Nova Sonic 2.0 3*10 + 12*2
  assert.ok(Math.abs(get("Nova Sonic").costLo - 61.2) < 1e-9);
  assert.ok(Math.abs(get("Nova Sonic 2.0").costLo - 54) < 1e-9);
  assert.deepEqual(get("Nova Sonic").textIn, [0.06]);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].costLo <= ranked[i].costLo);
  assert.equal(missing.length, 0);
  // Seoul has no Sonic offering: it is reported as unavailable, never ranked.
  const seoul = rankSpeech(P, base(), matches, 10, 2);
  assert.equal(seoul.ranked.length, 0);
  assert.ok(seoul.missing.some((x) => x.model === "Nova Sonic"));
});

test("relativeKo formats elapsed time in Korean", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(relativeKo(ago(5), now), "방금 전");
  assert.equal(relativeKo(ago(180), now), "3분 전");
  assert.equal(relativeKo(ago(2 * 3600 + 10), now), "2시간 전");
  assert.equal(relativeKo(ago(3 * 86400), now), "3일 전");
  assert.equal(relativeKo(new Date(now + 60000).toISOString(), now), "방금 전");
  assert.equal(relativeKo("garbage", now), "?");
});
