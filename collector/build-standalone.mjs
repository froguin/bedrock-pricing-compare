#!/usr/bin/env node
// Build a standalone single-file HTML: the dataset is dictionary-encoded and
// inlined, so the page opens straight from the filesystem (double-click) with no
// local server and no CORS problem. The served build still fetches pricing.json.
//
//   node collector/build-standalone.mjs  ->  dist/bedrock-pricing.html

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BPC_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
// --src / --out (repo-relative) let the Cloudscape prototype (app/) reuse this
// injector; defaults keep the production build unchanged.
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const SRC_HTML = resolve(ROOT, arg("--src", "web/index.html"));
const SRC_JSON = resolve(ROOT, "web/pricing.json");
const OUT = resolve(ROOT, arg("--out", "dist/bedrock-pricing.html"));

// Per-row fields the UI never reads — dropped from the inline payload.
const DROP = new Set(["raw_unit", "source", "sku", "effective_date", "offer_version"]);
// Low-cardinality fields worth interning into dictionaries.
// context_band and context_threshold MUST be here: without them the inlined payload loses the
// short/long-context distinction and the per-request cutoff; long-ctx rates merge back into
// standard, and settled prices reappear as ambiguous ranges in the deployed build only.
const DICT_FIELDS = ["provider", "model_id", "status", "endpoint_type",
                     "source_region", "service_tier", "execution_mode",
                     "context_band", "context_threshold", "dimension"];

const snap = JSON.parse(readFileSync(SRC_JSON, "utf8"));
const points = snap.price_points;

const dicts = Object.fromEntries(DICT_FIELDS.map(f => [f, []]));
const index = Object.fromEntries(DICT_FIELDS.map(f => [f, new Map()]));
const intern = (f, v) => {
  const m = index[f];
  let i = m.get(v);
  if (i === undefined) { i = dicts[f].length; dicts[f].push(v ?? null); m.set(v, i); }
  return i;
};

// rows become flat integer tuples + the price, in DICT_FIELDS order
const rows = points.map(p => [...DICT_FIELDS.map(f => intern(f, p[f])), p.price_per_1m]);

const meta = {};
for (const [k, v] of Object.entries(snap)) if (k !== "price_points" && !DROP.has(k)) meta[k] = v;

const payload = { fields: DICT_FIELDS, dicts, rows, meta };

const expander = `<script>
// Expand the dictionary-encoded payload back into the shape the page expects.
(function(){
  var P = ${JSON.stringify(payload)};
  var F = P.fields, D = P.dicts, out = new Array(P.rows.length);
  for (var i = 0; i < P.rows.length; i++) {
    var r = P.rows[i], o = {};
    for (var j = 0; j < F.length; j++) o[F[j]] = D[F[j]][r[j]];
    o.price_per_1m = r[F.length];
    out[i] = o;
  }
  var snap = Object.assign({}, P.meta);
  snap.price_points = out;
  window.__PRICING__ = snap;
})();
</script>
`;

const html = readFileSync(SRC_HTML, "utf8");
// The payload must run before the first module script (vite emits attributes
// such as `crossorigin`, so match the tag prefix, not the exact string).
const at = html.search(/<script type="module"[\s>]/);
if (at < 0) throw new Error(`module script marker not found in ${SRC_HTML}`);
const built = html.slice(0, at) + expander + html.slice(at);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, built);

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log(`standalone -> ${OUT}`);
console.log(`  points ${points.length} · inline payload ${mb(JSON.stringify(payload).length)} ` +
            `(raw json ${mb(readFileSync(SRC_JSON).length)}) · page ${mb(built.length)}`);
