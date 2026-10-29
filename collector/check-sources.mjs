#!/usr/bin/env node
/**
 * Cheap change detector for the scheduled refresh (runs every 30 min).
 *
 * 1. Offer files: conditional GET of each service's current/region_index.json
 *    (If-None-Match -> 304 with no body when unchanged). Compares the published
 *    version against data/state.json.
 * 2. English pricing page: hashes ONLY the text of its <table> elements. The
 *    raw HTML changes on every request (CSP nonce), so a whole-page hash would
 *    report a change every run.
 *
 * Writes data/state.json only when something changed, and emits
 * offer_changed / page_changed to $GITHUB_OUTPUT (also printed for local runs).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractPricingSection, extractRegionalAvailabilitySection, MODEL_CARD_INDEXES, parseModelCardIndex } from "./model-card-parse.mjs";

const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "data/state.json");
const SERVICES = ["AmazonBedrock", "AmazonBedrockFoundationModels"];
const PAGE = "https://aws.amazon.com/bedrock/pricing/";
const DOCS = "https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html";

// Seed from the newest committed snapshots so the first run compares against
// what is actually deployed, not against nothing.
function seedState() {
  const pricing = JSON.parse(readFileSync(join(ROOT, "web/pricing.json"), "utf8"));
  const offer = {};
  for (const s of SERVICES) offer[s] = { version: pricing.as_of?.[s] ?? null, etag: null };
  return { offer, page: { tables_hash: null }, docs: { tables_hash: null } };
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : seedState();
const next = structuredClone(state);
let offerChanged = false, pageChanged = false, docsChanged = false;
const notes = [];

for (const s of SERVICES) {
  const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${s}/current/region_index.json`;
  const prev = state.offer?.[s] ?? {};
  const headers = prev.etag ? { "If-None-Match": prev.etag } : {};
  const r = await fetch(url, { headers });
  if (r.status === 304) { notes.push(`${s}: 304 unchanged (${prev.version})`); continue; }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const j = await r.json();
  // currentVersionUrl looks like /offers/v1.0/aws/<code>/<version>/<region>/index.json
  const version = Object.values(j.regions)[0]?.currentVersionUrl.split("/")[5];
  if (!version) throw new Error(`${s}: cannot read version from region_index`);
  next.offer[s] = { version, etag: r.headers.get("etag") };
  if (version !== prev.version) {
    offerChanged = true;
    notes.push(`${s}: ${prev.version} -> ${version}`);
  } else {
    notes.push(`${s}: unchanged (${version}), etag refreshed`);
  }
}

{
  const r = await fetch(PAGE);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${PAGE}`);
  const html = await r.text();
  const tables = (html.match(/<table[\s\S]*?<\/table>/gi) || [])
    .map((t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  // A page that suddenly has no tables is a fetch/layout failure, not "no prices".
  if (tables.length < 20) throw new Error(`pricing page has only ${tables.length} tables -- refusing to record`);
  const hash = createHash("sha256").update(tables.join("\n")).digest("hex");
  if (hash !== state.page?.tables_hash) {
    pageChanged = state.page?.tables_hash != null; // first sighting is a baseline, not a change
    notes.push(`pricing page tables: ${pageChanged ? "CHANGED" : "baseline recorded"} (${tables.length} tables)`);
    next.page = { tables_hash: hash, tables: tables.length };
  } else {
    notes.push(`pricing page tables: unchanged (${tables.length} tables)`);
  }
}

// English documentation is source #2 for release and regional availability.
// Hash only compatibility tables so navigation/chrome changes do not rebuild.
{
  const r = await fetch(DOCS);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${DOCS}`);
  const html = await r.text();
  const tables = (html.match(/<table[\s\S]*?<\/table>/gi) || [])
    .map((t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  if (tables.length < 50) throw new Error(`documentation has only ${tables.length} compatibility tables -- refusing to record`);
  const hash = createHash("sha256").update(tables.join("\n")).digest("hex");
  if (hash !== state.docs?.tables_hash) {
    docsChanged = state.docs?.tables_hash != null;
    notes.push(`English documentation: ${docsChanged ? "CHANGED" : "baseline recorded"} (${tables.length} tables)`);
    next.docs = { tables_hash: hash, tables: tables.length };
  } else notes.push(`English documentation: unchanged (${tables.length} tables)`);
}

// Provider model-card indexes and their Pricing / Regional Availability sections are English
// documentation too. Hashing the index discovers a new card before the compatibility catalog catches
// up; hashing both sections detects price and routing changes without waiting for another source.
{
  const providers = (process.env.BPC_CARD_PROVIDERS || "OpenAI").split(",").map((s) => s.trim()).filter(Boolean);
  const docsFile = join(ROOT, "data/english-docs.json");
  const urls = new Set(existsSync(docsFile)
    ? JSON.parse(readFileSync(docsFile, "utf8")).models
        .filter((m) => providers.includes(m.provider) && /\/model-card-[^/]+\.html$/.test(m.doc_url)).map((m) => m.doc_url)
    : []);
  const indexParts = [];
  let failed = 0;
  for (const provider of providers) {
    const indexUrl = MODEL_CARD_INDEXES[provider];
    if (!indexUrl) continue;
    try {
      const r = await fetch(indexUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cards = parseModelCardIndex(await r.text(), indexUrl, provider);
      if (cards.length < 3) throw new Error(`only ${cards.length} cards`);
      indexParts.push(`${indexUrl}\n${cards.map((m) => `${m.model_id}|${m.doc_url}`).join("\n")}`);
      for (const card of cards) urls.add(card.doc_url);
    } catch { failed++; }
  }
  const sortedUrls = [...urls].sort();
  if (!sortedUrls.length) notes.push("model cards: no card list yet, skipped");
  else if (failed) notes.push(`model-card indexes: ${failed} could not be fetched, previous hash kept`);
  else {
    const parts = [];
    for (let i = 0; i < sortedUrls.length; i += 4) {
      parts.push(...await Promise.all(sortedUrls.slice(i, i + 4).map(async (u) => {
        try {
          const r = await fetch(u);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const html = await r.text();
          const pricing = extractPricingSection(html) ?? "";
          const availability = extractRegionalAvailabilitySection(html) ?? "";
          const compact = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return `${u}\n${compact(pricing)}\n${compact(availability)}`;
        } catch { failed++; return null; }
      })));
    }
    if (failed) notes.push(`model cards: ${failed}/${sortedUrls.length} could not be fetched, previous hash kept`);
    else {
      const hash = createHash("sha256").update([...indexParts, ...parts].join("\n")).digest("hex");
      if (hash !== state.cards?.pricing_hash) {
        const changed = state.cards?.pricing_hash != null;
        if (changed) docsChanged = true;
        notes.push(`model cards: ${changed ? "content CHANGED" : "baseline recorded"} (${sortedUrls.length} cards)`);
        next.cards = { pricing_hash: hash, cards: sortedUrls.length, indexes: indexParts.length };
      } else notes.push(`model cards: unchanged (${sortedUrls.length} cards)`);
    }
  }
}

const dirty = JSON.stringify(next) !== JSON.stringify(state);
if (dirty) writeFileSync(STATE, JSON.stringify(next, null, 2) + "\n");

const out = `offer_changed=${offerChanged}\npage_changed=${pageChanged}\ndocs_changed=${docsChanged}\nstate_dirty=${dirty}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Source check\n\n" + notes.map((n) => `- ${n}`).join("\n") + "\n");
}
console.log(notes.join("\n"));
process.stdout.write(out);
