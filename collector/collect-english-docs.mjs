#!/usr/bin/env node
/** English Bedrock documentation collector (source priority #2).
 * The regional compatibility tables establish whether each documented model is
 * in-region, Geo, or Global on bedrock-runtime / bedrock-mantle.
 */
import { writeJsonIfChanged } from "./write-stable.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = process.env.BPC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_URL = "https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html";
const r = await fetch(DOC_URL); if (!r.ok) throw new Error(`HTTP ${r.status} ${DOC_URL}`);
const html = await r.text();
const clean = (s) => s.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const PROVIDERS = { anthropic:"Anthropic", openai:"OpenAI", zai:"Z AI", "z-ai":"Z AI", xai:"xAI", amazon:"Amazon",
  ai21:"AI21 Labs", cohere:"Cohere", deepseek:"DeepSeek", google:"Google", luma:"Luma AI", meta:"Meta",
  minimax:"MiniMax AI", mistral:"Mistral AI", moonshot:"Moonshot AI", nvidia:"NVIDIA", qwen:"Qwen",
  stability:"Stability AI", twelvelabs:"TwelveLabs", writer:"Writer" };
const providerFromHref = (href) => {
  const m = href.match(/model-card-([a-z0-9-]+?)(?:-|\.html)/i); if (!m) return null;
  for (const [k,v] of Object.entries(PROVIDERS)) if (m[1].startsWith(k)) return v;
  return null;
};
const models=[];
for (const mt of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
  const block=mt[0]; const cap=block.match(/<caption>[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/caption>/i);
  if (!cap) continue;
  const model_id=clean(cap[2]), href=new URL(cap[1],DOC_URL).href, provider=providerFromHref(cap[1]);
  if (!provider || !model_id) continue;
  const rows=[...block.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(tr=>[...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c=>c[1]));
  if (rows.length<2) continue;
  const headers=rows[0].map(clean); const paths=[];
  headers.slice(1).forEach((h,i)=>paths.push({i:i+1,path:/Global/i.test(h)?"global-cris":/Geo/i.test(h)?"regional-cris":/mantle/i.test(h)?"in-region-mantle":/In-Region/i.test(h)?"in-region":null}));
  const availability={"in-region":[],"in-region-mantle":[],"regional-cris":[],"global-cris":[]}; let legacy=false;
  for(const row of rows.slice(1)){
    const region=clean(row[0]||"").match(/\b((?:af|ap|ca|eu|il|me|mx|sa|us)-(?:gov-)?[a-z]+-\d)\b/)?.[1]; if(!region)continue;
    for(const p of paths){ if(!p.path)continue; const cell=row[p.i]||""; const t=clean(cell); if(/alt="supported"/i.test(cell)||/\b(?:Available|Legacy)\b|EOL:/i.test(t)){availability[p.path].push(region);if(/Legacy|EOL:/i.test(t))legacy=true;} }
  }
  for(const k of Object.keys(availability)) availability[k]=[...new Set(availability[k])].sort();
  models.push({provider,model_id,doc_url:href,status:/preview/i.test(model_id)?"preview":legacy?"legacy":"ga",availability});
}
if(models.length<50)throw new Error(`documentation parse collapsed: ${models.length} model tables`);
const out={generated_at:new Date().toISOString(),source:DOC_URL,models:models.sort((a,b)=>a.provider.localeCompare(b.provider)||a.model_id.localeCompare(b.model_id))};
writeJsonIfChanged(join(ROOT,"data/english-docs.json"),out,2);
console.log(`English docs: ${models.length} model availability tables`);
