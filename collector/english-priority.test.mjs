import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const snap = JSON.parse(readFileSync(new URL("../web/pricing.json", import.meta.url)));
const P = snap.price_points;
const values = (model, region, endpoint, source) => Object.fromEntries(P
  .filter((p) => p.model_id === model && p.source_region === region && p.endpoint_type === endpoint
    && p.service_tier === "standard" && p.execution_mode === "online"
    && p.context_band === "standard" && (!source || p.source === source)
    && /^(input|output)$/.test(p.dimension))
  .map((p) => [p.dimension, p.price_per_1m]));

test("source priority is English Pricing, English Documentation, then API", () => {
  assert.deepEqual(snap.source_priority, ["english-pricing-page", "english-documentation", "price-list-api"]);
  assert.ok(snap.english_page_points > 0);
  assert.ok(snap.api_fallback_points > 0);
});

test("GLM 5.3 is calculable from English Pricing before offer-file publication", () => {
  assert.deepEqual(values("GLM 5.3", "ap-northeast-2", "global-cris", "english-pricing-page"), { input: 1.68, output: 5.28 });
  assert.equal(snap.announced_models.find((m) => m.name === "GLM 5.3")?.pricing_available, true);
});

test("Kimi K3 uses the English page Global CRIS rate", () => {
  assert.deepEqual(values("Kimi K3", "ap-northeast-2", "global-cris", "english-pricing-page"), { input: 3, output: 15 });
});

test("GPT-6 Astra is priced by the API; Sol/Luna/6.1 by their model cards", () => {
  assert.deepEqual(values("OpenAI GPT-6 Astra", "ap-northeast-2", "global-cris"), { input: 10, output: 50 });
  const priced = new Map(snap.announced_models.filter((m) => /^GPT-6/.test(m.name)).map((m) => [m.name, m.pricing_available]));
  for (const name of ["GPT-6 Astra", "GPT-6 Sol", "GPT-6 Luna", "GPT-6.1 Sol"]) assert.equal(priced.get(name), true, name);
  // Global CRIS is the cheaper route; these come from the cards' Pricing tables, not the Price List.
  assert.deepEqual(values("GPT-6 Sol", "ap-northeast-2", "global-cris", "english-model-card"), { input: 2, output: 10 });
  assert.deepEqual(values("GPT-6 Luna", "ap-northeast-2", "global-cris", "english-model-card"), { input: 0.1, output: 0.5 });
  assert.deepEqual(values("GPT-6.1 Sol", "ap-northeast-2", "global-cris", "english-model-card"), { input: 2, output: 10 });
});

test("documentation remaps mislabeled API in-region rows to Geo", () => {
  const rows = P.filter((p) => ["Llama 3.2 3B", "Claude Opus 4.1"].includes(p.model_id));
  assert.ok(rows.some((p) => p.model_id === "Llama 3.2 3B"));
  assert.ok(rows.some((p) => p.model_id === "Claude Opus 4.1"));
  assert.ok(rows.every((p) => p.endpoint_type === "regional-cris"));
});

test("custom-model training inference prices never override base model pricing", () => {
  const x = values("GPT OSS 20B", "us-east-1", "in-region");
  assert.notEqual(x.input, 0.09);
  assert.notEqual(x.output, 0.39);
});

test("unsupported standard Grok SKU is not merged into its documented Global rate", () => {
  for (const model of ["Grok 4.6", "Grok 4.7"]) {
    assert.deepEqual(values(model, "ap-northeast-2", "global-cris"), { input: 2, output: 6 });
  }
});

test("every cross-source mismatch is explicit and English values win", () => {
  assert.ok(snap.source_conflicts.length > 0);
  const c = snap.source_conflicts[0];
  assert.ok(!c.api_prices.includes(c.english_price));
  const matching = P.filter((p) => [p.provider, String(p.model_id).toLowerCase().replace(/\b(amazon|anthropic|meta|openai|xai|z ai|mistral ai|moonshot ai|nvidia)\b/g, "").replace(/\b(instruct|preview)\b/g, "").replace(/\.0\b/g, "").replace(/[^a-z0-9]+/g, "").replace(/^kimik(?=\d)/, "kimi"), p.endpoint_type, p.source_region, p.service_tier, p.execution_mode, p.dimension, p.context_band || "standard"].join("|") === c.key);
  assert.ok(matching.some((p) => p.source === "english-pricing-page" && p.price_per_1m === c.english_price));
});
