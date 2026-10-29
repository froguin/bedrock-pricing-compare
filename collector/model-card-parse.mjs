/**
 * Parser for the "Pricing" section of an Amazon Bedrock model-card page
 * (docs.aws.amazon.com/bedrock/latest/userguide/model-card-<provider>-<model>.html).
 *
 * The section is a sequence of <h3> headings and <table>s. A heading carries up to three facets
 * that apply to the tables below it until the next heading restates them:
 *   scope  "Commercial Regions" | "AWS GovCloud (US-West)" | "AWS GovCloud (US-East and US-West)"
 *   band   "short context (272K input tokens or fewer)" | "long context (more than 272K ...)"
 *   tier   "Standard" | "Ultrafast"   (absent -> standard)
 * Each table row is one inference option; the columns are Input, cache write, cache read, Output.
 *
 * Nothing is guessed: a row whose option label is not recognised, or a price cell that is neither a
 * dollar amount nor an empty marker, is reported in `skipped` instead of being turned into a number.
 */

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

export const MODEL_CARD_INDEXES = {
  OpenAI: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html",
};

/** Discover every concrete model-card linked from a provider index. */
export function parseModelCardIndex(html, indexUrl, provider) {
  const cards = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const model_id = text(m[2]);
    if (!model_id) continue;
    let doc_url;
    try { doc_url = new URL(decode(m[1]), indexUrl).href; }
    catch { continue; }
    if (!/\/model-card-[^/]+\.html$/i.test(new URL(doc_url).pathname)) continue;
    cards.set(doc_url, { provider, model_id, doc_url });
  }
  return [...cards.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));
}

export function extractRegionalAvailabilitySection(html) {
  const m = html.match(/<h2\b[^>]*>\s*Regional Availability\s*<\/h2>([\s\S]*?)(?=<h2\b|$)/i);
  return m ? m[1] : null;
}

/** Parse the per-card bedrock-mantle / bedrock-runtime availability matrices. */
export function parseRegionalAvailability(html) {
  const section = extractRegionalAvailabilitySection(html);
  const availability = { "in-region": [], "in-region-mantle": [], "regional-cris": [], "global-cris": [] };
  if (section == null) return { availability, tables: 0, has_availability: false };

  let runtime = null, tables = 0;
  const yes = (cell) => /icon-yes\.png/i.test(cell) || /alt="[^"]*(?:checkmark|supported)[^"]*"/i.test(cell);
  for (const tok of section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>|<table\b[\s\S]*?<\/table>/gi)) {
    if (tok[1]) {
      const h = text(tok[1]);
      if (/availability using the .*bedrock-mantle/i.test(h)) runtime = "mantle";
      else if (/availability using the .*bedrock-runtime/i.test(h)) runtime = "runtime";
      continue;
    }
    if (!runtime) continue;
    tables++;
    const trs = [...tok[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
      .map((tr) => [...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1]));
    if (trs.length < 2) continue;
    const header = trs[0].map(text);
    const cols = {
      inRegion: header.findIndex((x) => /^in-region$/i.test(x)),
      geo: header.findIndex((x) => /^geo$/i.test(x)),
      global: header.findIndex((x) => /^global$/i.test(x)),
    };
    for (const cells of trs.slice(1)) {
      const region = text(cells[0] || "").match(/\b((?:af|ap|ca|eu|il|me|mx|sa|us)-(?:gov-)?[a-z]+-\d)\b/i)?.[1];
      if (!region) continue;
      if (cols.inRegion >= 0 && yes(cells[cols.inRegion] || ""))
        availability[runtime === "mantle" ? "in-region-mantle" : "in-region"].push(region);
      if (cols.geo >= 0 && yes(cells[cols.geo] || "")) availability["regional-cris"].push(region);
      if (cols.global >= 0 && yes(cells[cols.global] || "")) availability["global-cris"].push(region);
    }
  }
  for (const k of Object.keys(availability)) availability[k] = [...new Set(availability[k])].sort();
  return { availability, tables, has_availability: tables > 0 };
}
const text = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function extractPricingSection(html) {
  const m = html.match(/<h2\b[^>]*>\s*Pricing\s*<\/h2>([\s\S]*?)(?=<h2\b|$)/i);
  return m ? m[1] : null;
}

function optionToEndpoint(label) {
  const l = label.toLowerCase().replace(/\s+/g, " ");
  const hint = label.match(/\(((?:af|ap|ca|eu|il|me|mx|sa|us)-[a-z]+-\d)\)/i)?.[1]
    || label.match(/bedrock-mantle in ((?:af|ap|ca|eu|il|me|mx|sa|us)-[a-z]+-\d)/i)?.[1] || null;
  // "In-Region", "Mantle in-Region", and GPT-6.1's "Regional (bedrock-mantle in US East ...)"
  if (/^(mantle )?in-region/.test(l) || /^regional \(? ?bedrock-mantle/.test(l)) return { endpoint: "in-region", region_hint: hint };
  // "Geo CRIS", "US Geo CRIS", and GPT-6.1's "US CRIS (bedrock-runtime)"
  if (/\bgeo cris\b/.test(l) || /^us cris\b/.test(l)) return { endpoint: "regional-cris", region_hint: hint };
  if (/\bglobal cris\b/.test(l)) return { endpoint: "global-cris", region_hint: hint };
  return { endpoint: null, region_hint: hint };
}

function govRegions(heading) {
  const west = /us-west/i.test(heading), east = /us-east/i.test(heading);
  const out = [];
  if (east) out.push("us-gov-east-1");
  if (west) out.push("us-gov-west-1");
  return out;
}

/** Returns { rows, skipped, tables } for the HTML of one model-card page (or only its Pricing section). */
export function parsePricingSection(html) {
  const section = extractPricingSection(html) ?? (/<table\b/i.test(html) ? html : null);
  if (section == null) return { rows: [], skipped: [], tables: 0, has_pricing: false, refers_to_pricing_page: false };
  const refersToPricingPage = /pricing page/i.test(text(section)) && !/<table\b/i.test(section);

  const rows = [], skipped = [];
  let scope = "commercial", govRegs = [], band = null, contextThreshold = null, tier = "standard", tables = 0;

  for (const tok of section.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>|<table\b[\s\S]*?<\/table>/gi)) {
    if (tok[1]) {
      const h = text(tok[2]);
      const isScope = /govcloud|commercial/i.test(h);
      if (isScope) {
        scope = /govcloud/i.test(h) ? "govcloud" : "commercial";
        govRegs = scope === "govcloud" ? govRegions(h) : [];
        band = null;
        contextThreshold = null;
        tier = "standard";
      }
      if (/ultrafast/i.test(h)) tier = "ultrafast";
      else if (/\bstandard\b/i.test(h) && isScope) tier = "standard";
      if (/short context|or fewer/i.test(h)) band = "standard";
      else if (/long context|more than/i.test(h)) band = "long-ctx";
      const threshold = h.match(/(\d[\d,]*(?:\.\d+)?)\s*([KM])?\s*input tokens/i);
      if (threshold) {
        const scale = !threshold[2] ? 1 : threshold[2].toUpperCase() === "M" ? 1_000_000 : 1_000;
        contextThreshold = Math.round(Number(threshold[1].replace(/,/g, "")) * scale);
      }
      continue;
    }
    tables++;
    const trs = [...tok[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
      .map((tr) => [...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1])));
    if (trs.length < 2) continue;
    const header = trs[0];
    const col = {
      input: header.findIndex((x) => /^input$/i.test(x)),
      cache_write: header.findIndex((x) => /cache write/i.test(x)),
      cache_read: header.findIndex((x) => /cache read/i.test(x)),
      output: header.findIndex((x) => /^output$/i.test(x)),
    };
    if (col.input < 0 || col.output < 0) { skipped.push({ reason: "table without Input/Output columns", header }); continue; }
    for (const cells of trs.slice(1)) {
      const label = cells[0] || "";
      const { endpoint, region_hint } = optionToEndpoint(label);
      if (!endpoint) { skipped.push({ reason: "unrecognised inference option", label }); continue; }
      const prices = {};
      let bad = null;
      for (const [dim, i] of Object.entries(col)) {
        if (i < 0) { prices[dim] = null; continue; }
        const cell = (cells[i] ?? "").replace(/,/g, "");
        const m = cell.match(/^\$\s*(\d+(?:\.\d+)?)$/);
        if (m) prices[dim] = +m[1];
        else if (cell === "" || /^[—–-]+$/.test(cell) || /^n\/a$/i.test(cell)) prices[dim] = null;
        else { bad = `${dim}: "${cells[i]}"`; break; }
      }
      if (bad || prices.input == null || prices.output == null) {
        skipped.push({ reason: bad ? `unparsable price (${bad})` : "row without input/output price", label });
        continue;
      }
      rows.push({
        scope, regions: scope === "govcloud" ? govRegs : [], tier, band: band || "standard",
        context_threshold: contextThreshold, option: label, endpoint, region_hint, ...prices,
      });
    }
  }
  return { rows, skipped, tables, has_pricing: true, refers_to_pricing_page: refersToPricingPage };
}
