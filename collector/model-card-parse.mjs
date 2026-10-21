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
  let scope = "commercial", govRegs = [], band = null, tier = "standard", tables = 0;

  for (const tok of section.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>|<table\b[\s\S]*?<\/table>/gi)) {
    if (tok[1]) {
      const h = text(tok[2]);
      const isScope = /govcloud|commercial/i.test(h);
      if (isScope) {
        scope = /govcloud/i.test(h) ? "govcloud" : "commercial";
        govRegs = scope === "govcloud" ? govRegions(h) : [];
        band = null;
        tier = "standard";
      }
      if (/ultrafast/i.test(h)) tier = "ultrafast";
      else if (/\bstandard\b/i.test(h) && isScope) tier = "standard";
      if (/short context|or fewer/i.test(h)) band = "standard";
      else if (/long context|more than/i.test(h)) band = "long-ctx";
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
        option: label, endpoint, region_hint, ...prices,
      });
    }
  }
  return { rows, skipped, tables, has_pricing: true, refers_to_pricing_page: refersToPricingPage };
}
