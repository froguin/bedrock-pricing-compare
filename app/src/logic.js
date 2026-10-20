// Pure pricing logic, ported 1:1 from web/index.html so the Cloudscape UI and
// the vanilla page rank the same rows with the same numbers. No React here.

export const PATH_KO = {
  "in-region":     { label: "리전 내 처리",     help: "이 리전 안에서 처리됩니다", type: "success" },
  "global-cris":   { label: "글로벌 분산 처리", help: "데이터가 리전 밖에서 처리될 수 있습니다", type: "info" },
  "regional-cris": { label: "지역 묶음 분산 처리", help: "문서화된 지리적 리전 그룹 안에서 처리됩니다", type: "info" },
};
export const TIER_KO = { standard: "표준", priority: "우선 처리", flex: "유연", "latency-optimized": "지연 최소화" };
export const STATUS_KO = { ga: "정식 제공", legacy: "구형", preview: "미리보기", internal: "내부 코드명" };
export const BAND_KO = { standard: "기본 입력 길이", "long-ctx": "긴 입력" };
export const MODE_KO = { online: "즉시 응답", batch: "일괄 처리" };
export const PRESETS = { "일반 챗봇": [10, 2], "RAG · 요약": [20, 1], "코딩 보조": [2, 1], "대량 추출": [100, 10] };
export const SIZES = ["10B 미만", "10~70B", "70B 초과", "미공개"];

export const REGION_KO = {
  "ap-northeast-1": "도쿄", "ap-northeast-2": "서울", "ap-northeast-3": "오사카",
  "ap-south-1": "뭄바이", "ap-south-2": "하이데라바드",
  "ap-southeast-1": "싱가포르", "ap-southeast-2": "시드니", "ap-southeast-3": "자카르타",
  "ap-southeast-4": "멜버른", "ap-southeast-5": "쿠알라룸푸르", "ap-southeast-6": "뉴질랜드",
  "ap-southeast-7": "방콕", "ap-east-1": "홍콩", "ap-east-2": "타이베이",
  "us-east-1": "버지니아", "us-east-2": "오하이오", "us-west-1": "캘리포니아", "us-west-2": "오레곤",
  "us-gov-east-1": "GovCloud 동부", "us-gov-west-1": "GovCloud 서부",
  "eu-west-1": "아일랜드", "eu-west-2": "런던", "eu-west-3": "파리",
  "eu-central-1": "프랑크푸르트", "eu-central-2": "취리히", "eu-north-1": "스톡홀름",
  "eu-south-1": "밀라노", "eu-south-2": "스페인",
  "ca-central-1": "캐나다 중부", "ca-west-1": "캘거리",
  "sa-east-1": "상파울루", "mx-central-1": "멕시코",
  "me-central-1": "UAE", "me-south-1": "바레인", "il-central-1": "텔아비브",
  "af-south-1": "케이프타운",
};
export const regionName = (r) => REGION_KO[r] || r;
export const regionFull = (r) => (REGION_KO[r] ? `${REGION_KO[r]} (${r})` : r);
export const REGION_ORDER = [
  ["아시아·태평양", (r) => /^ap-/.test(r)],
  ["미국", (r) => /^us-/.test(r)],
  ["유럽", (r) => /^eu-/.test(r)],
  ["그 외", (r) => !/^(ap|us|eu)-/.test(r)],
];

/* ---------------- search (Korean aliases + version-aware tokens) ---------------- */
const ALIASES = {
  "소넷": "sonnet", "소네트": "sonnet", "쏘넷": "sonnet",
  "하이쿠": "haiku", "하이꾸": "haiku", "오푸스": "opus", "오퍼스": "opus",
  "클로드": "claude", "크로드": "claude",
  "노바": "nova", "마이크로": "micro", "라이트": "lite", "프로": "pro", "프리미어": "premier",
  "라마": "llama", "미스트랄": "mistral", "믹스트랄": "mixtral",
  "딥식": "deepseek", "딥시크": "deepseek",
  "지피티": "gpt", "챗지피티": "gpt", "오픈에이아이": "openai",
  "네모트론": "nemotron", "큐원": "qwen", "쿠엔": "qwen",
  "젬마": "gemma", "제마": "gemma", "그록": "grok", "키미": "kimi",
  "잠바": "jamba", "타이탄": "titan", "커맨드": "command", "임베딩": "embed",
};
export function tokens(str) {
  let s = String(str || "").toLowerCase().normalize("NFKC");
  s = s.replace(/^[a-z0-9]+\./, " ");
  s = s.replace(/(\d)-(\d)/g, "$1.$2");
  s = s.replace(/[^a-z0-9.가-힣]+/g, " ");
  s = s.replace(/\.(?!\d)/g, " ");
  return s.split(/\s+/).filter(Boolean);
}
const KO_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
function segmentKorean(t) {
  const parts = []; let i = 0;
  while (i < t.length) {
    const hit = KO_KEYS.find((k) => t.startsWith(k, i));
    if (!hit) return null;
    parts.push(ALIASES[hit]); i += hit.length;
  }
  return parts.length > 1 ? parts.flatMap(tokens) : null;
}
function alternatives(t) {
  const alts = [[t]];
  if (ALIASES[t]) alts.push(tokens(ALIASES[t]));
  if (/^[가-힣]+$/.test(t)) { const seg = segmentKorean(t); if (seg) alts.push(seg); }
  return alts;
}
export function makeMatcher(P) {
  const bags = {};
  for (const p of P) {
    const k = p.provider + "\u0001" + p.model_id;
    if (!bags[k]) bags[k] = [...new Set([...tokens(p.model_id), ...tokens(p.provider)])];
  }
  return (provider, modelId, q) => {
    if (!q) return true;
    const bag = bags[provider + "\u0001" + modelId]; if (!bag) return false;
    const hit = (t) => bag.some((b) => b.startsWith(t));
    return tokens(q).every((raw) => alternatives(raw).some((alt) => alt.every(hit)));
  };
}

// Size comes from the published name only — never guessed from price.
export function sizeBucket(modelId) {
  const m = String(modelId).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/i);
  let b = null;
  if (m) b = parseFloat(m[1]) * parseFloat(m[2]);
  else {
    const s = String(modelId).match(/(?:^|[\s\-_])(\d+(?:\.\d+)?)\s*b\b/i);
    if (s) b = parseFloat(s[1]);
  }
  if (b == null) return "미공개";
  if (b < 10) return "10B 미만";
  if (b <= 70) return "10~70B";
  return "70B 초과";
}

/* ---------------- format ---------------- */
export const money = (v) => (v >= 100 ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  : v >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(3));
export const rate = (v) => (v >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(3));
export const rateRange = (v) => (v.length > 1 ? `${rate(v[0])}–${rate(v[v.length - 1])}` : rate(v[0]));

/* ---------------- aggregation ---------------- */
// provider/model -> region -> path -> dimension -> Set(prices)
export function buildIndex(P, f, matches) {
  const idx = {}, statusOf = {};
  for (const p of P) {
    if (!/^(input|output)$/.test(p.dimension)) continue;
    if ((p.execution_mode || "online") !== f.mode) continue;
    if (!f.statuses.has(p.status || "ga")) continue;
    if (!f.tiers.has(p.service_tier)) continue;
    if (!f.bands.has(p.context_band || "standard")) continue;
    if (!f.vendors.has(p.provider)) continue;
    if (!f.sizes.has(sizeBucket(p.model_id))) continue;
    if (!matches(p.provider, p.model_id, f.q)) continue;
    const key = p.provider + "\u0001" + p.model_id;
    statusOf[key] = p.status || "ga";
    const node = (((idx[key] ??= {})[p.source_region] ??= {})[p.endpoint_type] ??= {});
    (node[p.dimension] ??= new Set()).add(p.price_per_1m);
  }
  return { idx, statusOf };
}

export const allowedPaths = (resid) => (resid === "strict" ? ["in-region"] : ["in-region", "regional-cris", "global-cris"]);

// monthly cost for one path, or null when a dimension is missing
export function costFor(pathNode, inM, outM) {
  if (!pathNode) return null;
  const i = pathNode.input, o = pathNode.output;
  if (!i || !o || !i.size || !o.size) return null;
  const iv = [...i].sort((a, b) => a - b), ov = [...o].sort((a, b) => a - b);
  const lo = iv[0] * inM + ov[0] * outM;
  const hi = iv[iv.length - 1] * inM + ov[ov.length - 1] * outM;
  return { lo, hi, ambiguous: lo !== hi, inRates: iv, outRates: ov };
}

export function rank(P, f, matches) {
  const { idx, statusOf } = buildIndex(P, f, matches);
  const paths = allowedPaths(f.resid);
  const ranked = [], partial = [], missing = [];
  for (const [key, regions] of Object.entries(idx)) {
    const [provider, model] = key.split("\u0001");
    if (isEmbeddingModel(model)) continue; // rendered in the input-only embedding section
    const here = regions[f.region];
    if (!here) { missing.push({ key, provider, model, where: Object.keys(regions).length }); continue; }
    let best = null;
    for (const path of paths) {
      const c = costFor(here[path], f.inM, f.outM);
      if (c && (!best || c.lo < best.cost.lo)) best = { path, cost: c };
    }
    if (!best) {
      const have = new Set();
      for (const path of Object.keys(here)) for (const d of Object.keys(here[path])) have.add(d);
      const only = [...have].map((d) => (d === "input" ? "입력" : "출력")).join(" · ");
      const blocked = f.resid === "strict" && (here["global-cris"] || here["regional-cris"]) && !here["in-region"];
      partial.push({ key, provider, model,
        reason: blocked ? "이 리전 안에서 처리되는 요금이 없습니다 (글로벌 분산 처리만 제공)"
                        : `${only} 단가만 있어 월 비용을 계산할 수 없습니다` });
      continue;
    }
    const inRegionCost = costFor(here["in-region"], f.inM, f.outM);
    ranked.push({ key, provider, model, status: statusOf[key], ...best, regions,
                  inRegionCost,
                  cheaperPathIsNonInRegion: best.path !== "in-region" && !!inRegionCost,
                  noInRegionHere: best.path !== "in-region" && !here["in-region"] });
  }
  ranked.sort((a, b) => a.cost.lo - b.cost.lo);
  // "N배" baseline: cheapest row with a settled (non-ambiguous) price
  const base = ranked.find((r) => !r.cost.ambiguous) || null;
  for (const r of ranked) r.mult = base && !r.cost.ambiguous ? r.cost.lo / base.cost.lo : null;
  for (const r of ranked) r.isBase = r === base;
  missing.sort((a, b) => b.where - a.where);
  return { ranked, partial, missing, base };
}

// Same model across regions, collapsed into price tiers (identical in/out rates
// and path -> one row), so ~30 regions read as 2-4 rows.
export function expandTiers(r, f) {
  const rows = [];
  for (const [rg, byPath] of Object.entries(r.regions)) {
    const paths = allowedPaths(f.resid);
    if (rg === f.region) {
      // Preserve every purchasable path for the selected region. The main row
      // still uses the cheapest path, but expansion must not hide its in-region
      // alternative (for example Opus 5 Seoul: Global $100, in-region $110).
      for (const path of paths) {
        const c = costFor(byPath[path], f.inM, f.outM);
        if (c) rows.push({ rg, path, c });
      }
      continue;
    }
    let best = null;
    for (const path of paths) {
      const c = costFor(byPath[path], f.inM, f.outM);
      if (c && (!best || c.lo < best.c.lo)) best = { path, c };
    }
    if (best) rows.push({ rg, ...best });
  }
  rows.sort((a, b) => a.c.lo - b.c.lo);
  const tiers = [];
  for (const x of rows) {
    const sig = `${x.c.inRates}|${x.c.outRates}|${x.path}`;
    let t = tiers.find((t) => t.sig === sig);
    if (!t) { t = { sig, c: x.c, path: x.path, regions: [] }; tiers.push(t); }
    t.regions.push(x.rg);
  }
  const mine = rows.find((x) => x.rg === f.region && x.path === r.path) || rows.find((x) => x.rg === f.region) || null;
  for (const t of tiers) {
    t.isMine = t.regions.includes(f.region);
    t.isChosen = !!(mine && t.isMine && t.path === mine.path && t.c.lo === mine.c.lo && t.c.hi === mine.c.hi);
    t.delta = mine && !t.isChosen ? Math.round((t.c.lo / mine.c.lo - 1) * 100) : null;
    t.regions.sort((a, b) => (b === f.region) - (a === f.region) || regionName(a).localeCompare(regionName(b), "ko"));
  }
  return { tiers, nRegions: new Set(rows.map((x) => x.rg)).size, cheapest: rows[0] || null, mine };
}

export const asOf = (v) => { const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : "?"; };
// KST (UTC+9) time. as_of "20261016210806" (UTC) -> "2026-10-17 06:08 KST"
const toKst = (d) => isNaN(d) ? "?" : (() => {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST`;
})();
export const asOfTime = (v) => { const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/); return m ? toKst(new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0)))) : "?"; };
// ISO "2026-10-19T12:33:05.036Z" (UTC) -> "2026-10-19 21:33 KST"
export const isoTime = (v) => { const d = new Date(v); return isNaN(d) ? "?" : toKst(d); };

// Korean relative time ("방금 전", "3분 전", "2시간 전", "3일 전"). Clock skew
// (future timestamps) reads as "방금 전"; an unparsable value returns "?".
export const relativeKo = (v, now = Date.now()) => {
  const t = new Date(v).getTime();
  if (isNaN(t)) return "?";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return "방금 전";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

export const isEmbeddingModel = (modelId) => /embed|embedding/i.test(String(modelId));

// Embeddings are input-only by design. Build the complete regional index first,
// then rank only offerings that are actually purchasable in the selected region.
export function rankEmbeddings(P, f, matches) {
  const byModel = new Map();
  for (const p of P) {
    if (!isEmbeddingModel(p.model_id) || p.dimension !== "input") continue;
    if ((p.execution_mode || "online") !== f.mode || !f.statuses.has(p.status || "ga")) continue;
    if (!f.tiers.has(p.service_tier) || !f.bands.has(p.context_band || "standard")) continue;
    if (!f.vendors.has(p.provider) || !matches(p.provider, p.model_id, f.q)) continue;
    if (!allowedPaths(f.resid).includes(p.endpoint_type)) continue;
    const key = `${p.provider}\u0001${p.model_id}`;
    const x = byModel.get(key) || { key, provider:p.provider, model:p.model_id, status:p.status || "ga", regions:{} };
    const rates = ((x.regions[p.source_region] ??= {})[p.endpoint_type] ??= new Set());
    rates.add(p.price_per_1m); byModel.set(key,x);
  }
  const ranked=[], missing=[];
  for(const x of byModel.values()){
    const here=x.regions[f.region];
    if(!here){ missing.push({key:x.key,provider:x.provider,model:x.model,where:Object.keys(x.regions).length}); continue; }
    const options=[];
    for(const path of allowedPaths(f.resid)){
      const rates=here[path];
      if(rates?.size) options.push({path,rates:[...rates].sort((a,b)=>a-b)});
    }
    if(!options.length){ missing.push({key:x.key,provider:x.provider,model:x.model,where:Object.keys(x.regions).length}); continue; }
    options.sort((a,b)=>a.rates[0]-b.rates[0]); const best=options[0];
    ranked.push({...x,path:best.path,rates:best.rates,costLo:best.rates[0]*f.inM,costHi:best.rates.at(-1)*f.inM});
  }
  ranked.sort((a,b)=>a.costLo-b.costLo); missing.sort((a,b)=>b.where-a.where);
  return { ranked, missing };
}

// Video generation is billed in the physical source region. As with token
// models, the primary table contains only rows available in the selected region;
// rows offered elsewhere are returned separately for the unavailable section.
export function groupVideoPrices(points = [], selectedRegion = null) {
  const map=new Map();
  for(const p of points.filter(p=>p.category==="video-generation"&&p.billing_unit==="second")){
    const key=[p.provider,p.model_id,p.variant,p.price_per_unit].join("\u0001");
    const x=map.get(key)||{key,provider:p.provider,model:p.model_id,variant:p.variant,rate:p.price_per_unit,regions:[]};
    x.regions.push(p.source_region); map.set(key,x);
  }
  const rows=[...map.values()].map(x=>({...x,regions:[...new Set(x.regions)].sort()}));
  if(!selectedRegion) return { ranked:rows.sort((a,b)=>a.rate-b.rate), missing:[] };
  const ranked=rows.filter(x=>x.regions.includes(selectedRegion)).sort((a,b)=>a.rate-b.rate);
  const missing=rows.filter(x=>!x.regions.includes(selectedRegion)).sort((a,b)=>b.regions.length-a.regions.length||a.rate-b.rate);
  return { ranked, missing };
}
export const SRC_KO = { AmazonBedrock: "Price List API(Bedrock)", AmazonBedrockFoundationModels: "Price List API(Marketplace)" };
