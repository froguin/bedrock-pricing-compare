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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "data/state.json");
const SERVICES = ["AmazonBedrock", "AmazonBedrockFoundationModels"];
const PAGE = "https://aws.amazon.com/bedrock/pricing/";

// Seed from the newest committed snapshots so the first run compares against
// what is actually deployed, not against nothing.
function seedState() {
  const pricing = JSON.parse(readFileSync(join(ROOT, "web/pricing.json"), "utf8"));
  const offer = {};
  for (const s of SERVICES) offer[s] = { version: pricing.as_of?.[s] ?? null, etag: null };
  return { offer, page: { tables_hash: null } };
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : seedState();
const next = structuredClone(state);
let offerChanged = false, pageChanged = false;
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

const dirty = JSON.stringify(next) !== JSON.stringify(state);
if (dirty) writeFileSync(STATE, JSON.stringify(next, null, 2) + "\n");

const out = `offer_changed=${offerChanged}\npage_changed=${pageChanged}\nstate_dirty=${dirty}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Source check\n\n" + notes.map((n) => `- ${n}`).join("\n") + "\n");
}
console.log(notes.join("\n"));
process.stdout.write(out);
