import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePricingSection, extractPricingSection } from "./model-card-parse.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const find = (rows, f) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v));

test("GPT-5.5: single In-Region row, short and long context, cache write absent", () => {
  const { rows, skipped, has_pricing } = parsePricingSection(fixture("openai-gpt-55-pricing.html"));
  assert.ok(has_pricing);
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(find(rows, { band: "standard" }), {
    scope: "commercial", regions: [], tier: "standard", band: "standard", option: "In-Region",
    endpoint: "in-region", region_hint: null, input: 5.5, cache_write: null, cache_read: 0.55, output: 33,
  });
  assert.equal(find(rows, { band: "long-ctx" }).output, 49.5);
});

test("GPT-5.6 Luna: In-Region / Geo CRIS / Global CRIS, then a GovCloud scope with both gov regions", () => {
  const { rows } = parsePricingSection(fixture("openai-gpt-56-luna-pricing.html"));
  const com = rows.filter((r) => r.scope === "commercial");
  assert.equal(com.length, 6);
  assert.deepEqual(find(com, { endpoint: "global-cris", band: "standard" }),
    { ...find(com, { endpoint: "global-cris", band: "standard" }), input: 0.2, cache_write: 0.25, cache_read: 0.02, output: 1.2 });
  assert.equal(find(com, { endpoint: "regional-cris", band: "long-ctx" }).output, 1.98);
  const gov = rows.filter((r) => r.scope === "govcloud");
  assert.equal(gov.length, 2);
  for (const g of gov) assert.deepEqual(g.regions, ["us-gov-east-1", "us-gov-west-1"]);
  assert.equal(find(gov, { band: "standard" }).input, 0.27);
  assert.equal(find(gov, { band: "long-ctx" }).input, 0.54);
});

test("GPT-6 Astra: Standard and Ultrafast tables are kept apart", () => {
  const { rows } = parsePricingSection(fixture("openai-gpt-6-astra-pricing.html"));
  const std = rows.filter((r) => r.tier === "standard"), ultra = rows.filter((r) => r.tier === "ultrafast");
  assert.equal(std.length, 6);
  assert.equal(ultra.length, 6);
  assert.deepEqual([find(std, { endpoint: "global-cris", band: "standard" }).input, find(std, { endpoint: "global-cris", band: "standard" }).output], [10, 50]);
  assert.deepEqual([find(std, { endpoint: "in-region", band: "standard" }).input, find(std, { endpoint: "in-region", band: "standard" }).output], [11, 55]);
  // Ultrafast is six times Standard, and "In-Region (us-east-1)" is still an in-region row with a region hint
  const u = find(ultra, { endpoint: "in-region", band: "standard" });
  assert.equal(u.input, 66);
  assert.equal(u.region_hint, "us-east-1");
});

test("GPT-6 Luna: 'Mantle in-Region' and 'US Geo CRIS' labels, 'Input — cache write' column", () => {
  const { rows, skipped } = parsePricingSection(fixture("openai-gpt-6-luna-pricing.html"));
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 6);
  assert.equal(find(rows, { endpoint: "in-region", band: "standard" }).option, "Mantle in-Region");
  assert.equal(find(rows, { endpoint: "regional-cris", band: "standard" }).option, "US Geo CRIS");
  assert.equal(find(rows, { endpoint: "regional-cris", band: "standard" }).cache_write, 0.1375);
  assert.equal(find(rows, { endpoint: "global-cris", band: "long-ctx" }).output, 0.75);
});

test("GPT-6.1 Sol labels (Regional (bedrock-mantle ...), US CRIS (bedrock-runtime)) are recognised", () => {
  const html = `<h2>Pricing</h2><h3>Standard — Commercial Regions, short context (272K input tokens or fewer)</h3>
  <table><tr><th>Inference option</th><th>Input</th><th>Input — cache write</th><th>Input — cache read</th><th>Output</th></tr>
  <tr><td>Regional (bedrock-mantle in US East (N. Virginia))</td><td>$2.20</td><td>$2.75</td><td>$0.11</td><td>$11.00</td></tr>
  <tr><td>US CRIS (bedrock-runtime)</td><td>$2.20</td><td>$2.75</td><td>$0.11</td><td>$11.00</td></tr>
  <tr><td>Global CRIS (bedrock-runtime)</td><td>$2.00</td><td>$2.50</td><td>$0.10</td><td>$10.00</td></tr></table>`;
  const { rows, skipped } = parsePricingSection(html);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows.map((r) => r.endpoint), ["in-region", "regional-cris", "global-cris"]);
  assert.equal(parsePricingSection(`<h2>Pricing</h2><table><tr><th>Inference option</th><th>Input</th><th>Output</th></tr>
    <tr><td>In-Region (bedrock-mantle in us-east-1)</td><td>$1.00</td><td>$2.00</td></tr></table>`).rows[0].region_hint, "us-east-1");
});

test("unknown option labels and unparsable prices are reported, never turned into numbers", () => {
  const html = `<h2>Pricing</h2><h3>Commercial Regions — short context</h3>
  <table><tr><th>Inference option</th><th>Input</th><th>Output</th></tr>
  <tr><td>Provisioned throughput</td><td>$1.00</td><td>$2.00</td></tr>
  <tr><td>In-Region</td><td>Contact sales</td><td>$2.00</td></tr>
  <tr><td>Global CRIS</td><td>$1,200.50</td><td>$2.00</td></tr></table>`;
  const { rows, skipped } = parsePricingSection(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input, 1200.5);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /unrecognised inference option/);
  assert.match(skipped[1].reason, /unparsable price/);
});

test("a card that only points to the pricing page yields no rows and says so", () => {
  const html = `<h2>Pricing</h2><p>For pricing information, see the Amazon Bedrock Pricing page.</p><h2>Next</h2>`;
  const r = parsePricingSection(html);
  assert.equal(r.rows.length, 0);
  assert.ok(r.refers_to_pricing_page);
  assert.equal(parsePricingSection("<h2>Model Details</h2>").has_pricing, false);
  assert.ok(extractPricingSection(html).includes("Pricing page"));
});

// --- merged data (web/pricing.json is regenerated by collector/merge.mjs) ---
const snap = JSON.parse(readFileSync(new URL("../web/pricing.json", import.meta.url)));
const P = snap.price_points;
const price = (model, region, endpoint, dimension, band = "standard") => P.find((p) =>
  p.model_id === model && p.source_region === region && p.endpoint_type === endpoint && p.service_tier === "standard"
  && p.execution_mode === "online" && p.dimension === dimension && (p.context_band || "standard") === band)?.price_per_1m;

test("every announced OpenAI model has a price after merging model-card pricing", () => {
  const unpriced = snap.announced_models.filter((m) => !m.pricing_available).map((m) => m.name);
  assert.deepEqual(unpriced, []);
  assert.ok(snap.model_card_points > 0);
  // the footer shows when the card prices were parsed; it needs a valid timestamp
  assert.ok(!Number.isNaN(Date.parse(snap.model_card_checked_at)), "model_card_checked_at");
  assert.ok(!Number.isNaN(Date.parse(snap.english_documentation_checked_at)), "english_documentation_checked_at");
});

test("GPT-5.5 In-Region price comes from its card in the bedrock-mantle regions", () => {
  assert.equal(price("GPT-5.5", "us-east-1", "in-region", "input"), 5.5);
  assert.equal(price("GPT-5.5", "us-east-2", "in-region", "output"), 33);
  assert.equal(price("GPT-5.5", "us-east-1", "in-region", "output", "long-ctx"), 49.5);
});

test("GPT-5.6 Sol Global CRIS is priced in Seoul, with the Global discount versus Geo/In-Region", () => {
  assert.equal(price("GPT-5.6 Sol", "ap-northeast-2", "global-cris", "input"), 4);
  assert.equal(price("GPT-5.6 Sol", "ap-northeast-2", "global-cris", "output"), 20);
  assert.equal(price("GPT-5.6 Sol", "us-east-1", "regional-cris", "output"), 22);
});

test("card prices never override the English page or the Price List API", () => {
  for (const p of P.filter((x) => x.source === "english-model-card")) {
    const other = P.find((x) => x !== p && x.source !== "english-model-card" && x.provider === p.provider && x.model_id === p.model_id
      && x.endpoint_type === p.endpoint_type && x.source_region === p.source_region && x.service_tier === p.service_tier
      && x.execution_mode === p.execution_mode && x.dimension === p.dimension && (x.context_band || "standard") === (p.context_band || "standard"));
    assert.equal(other, undefined, `${p.model_id} ${p.source_region} ${p.dimension} has two sources`);
  }
  // GPT-5.4 GovCloud: the API price is kept and the differing card price is only reported
  assert.equal(price("GPT 5.4", "us-gov-west-1", "in-region", "input"), 3.3);
  assert.ok(snap.model_card_conflicts.some((c) => c.key.includes("gpt54|in-region|us-gov-west-1") && c.model_card_price === 3.375));
});

test("GPT-6 Astra card prices agree with the Price List prices already published", () => {
  assert.equal(snap.model_card_conflicts.filter((c) => /gpt6astra/.test(c.key)).length, 0);
});

test("announced model URLs point at real model-card pages", () => {
  const u = (n) => snap.announced_models.find((m) => m.name === n)?.url;
  assert.match(u("Daybreak Blue: GPT-5.6 Sol"), /model-card-openai-gpt-daybreak-blue-56-sol\.html$/);
  assert.match(u("GPT-6.1 Sol"), /model-card-openai-gpt-6-1-sol\.html$/);
});
