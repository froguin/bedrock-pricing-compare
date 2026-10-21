// Scheduled Bedrock-pricing refresh — Lambda entry point.
//
// Runs the dependency-free collector chain against a writable /tmp tree, then
// re-inlines the fresh dataset into the vite shell and ships it to S3 +
// CloudFront. It does NOT run vite: the shell is produced by the GitHub Actions
// UI build and staged in the state bucket. See infra/lambda-refresh/README.md.
//
// Node 22 runtime. Uses only the AWS SDK v3 modules the runtime provides and
// Node builtins — no npm install, no bundler.
//
// Env (set by template.yaml):
//   STATE_BUCKET   S3 bucket holding the refresh state (data/, web/pricing.json, shell.html)
//   STATE_PREFIX   key prefix inside STATE_BUCKET (default "refresh-state")
//   SITE_BUCKET    S3 bucket CloudFront serves (index.html + .br/.gz)
//   DIST_ID        CloudFront distribution id to invalidate
//   FORCE          "true" to rebuild+deploy even when sources are unchanged

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient, CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

const REGION = process.env.AWS_REGION || "ap-northeast-2";
const STATE_BUCKET = must("STATE_BUCKET");
const STATE_PREFIX = (process.env.STATE_PREFIX || "refresh-state").replace(/\/+$/, "");
const SITE_BUCKET = must("SITE_BUCKET");
const DIST_ID = must("DIST_ID");

const WORK = "/tmp/work";                       // collector BPC_ROOT
const COLLECTOR = join(process.env.LAMBDA_TASK_ROOT || ".", "collector");
const s3 = new S3Client({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

// --- S3 state objects we round-trip. data/ is a whole subtree, so we list it. ---
const SHELL_KEY = `${STATE_PREFIX}/shell.html`;          // app/dist/index.html from the UI build
const PRICING_KEY = `${STATE_PREFIX}/web/pricing.json`;
const DATA_PREFIX = `${STATE_PREFIX}/data/`;             // mirrors repo data/ subtree

async function getObject(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: STATE_BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}
async function tryGetObject(key) {
  try { return await getObject(key); }
  catch (e) { if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null; throw e; }
}
async function putObject(key, body, contentType, extra = {}) {
  await s3.send(new PutObjectCommand({
    Bucket: STATE_BUCKET, Key: key, Body: body, ContentType: contentType, ...extra,
  }));
}

function run(script, args = []) {
  // Each collector script resolves its ROOT from BPC_ROOT, so all reads/writes
  // land under WORK. node: builtins only, so no node_modules needed.
  const out = execFileSync("node", [join(COLLECTOR, script), ...args], {
    env: { ...process.env, BPC_ROOT: WORK },
    cwd: WORK,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString();
}

// check-sources.mjs emits `key=value` lines; parse them into booleans.
function parseFlags(text) {
  const flags = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)=(true|false)$/);
    if (m) flags[m[1]] = m[2] === "true";
  }
  return flags;
}

// ---------- hydrate WORK from S3 ----------
async function hydrate() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, "data"), { recursive: true });
  mkdirSync(join(WORK, "web"), { recursive: true });
  mkdirSync(join(WORK, "app", "dist"), { recursive: true });
  mkdirSync(join(WORK, "dist"), { recursive: true });

  const shell = await tryGetObject(SHELL_KEY);
  if (!shell) throw new Error(`vite shell missing at s3://${STATE_BUCKET}/${SHELL_KEY} — run seed-state.sh`);
  writeFileSync(join(WORK, "app", "dist", "index.html"), shell);

  const pricing = await tryGetObject(PRICING_KEY);
  if (pricing) writeFileSync(join(WORK, "web", "pricing.json"), pricing);

  // Pull the whole data/ subtree (snapshots + state.json + english-*.json).
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: STATE_BUCKET, Prefix: DATA_PREFIX, ContinuationToken: token,
    }));
    for (const o of page.Contents || []) {
      const rel = o.Key.slice(STATE_PREFIX.length + 1);       // "data/..."
      const dest = join(WORK, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, await getObject(o.Key));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

// ---------- persist WORK/data + pricing back to S3 (history via versioning) ----------
async function persistState() {
  const pricingPath = join(WORK, "web", "pricing.json");
  if (existsSync(pricingPath))
    await putObject(PRICING_KEY, readFileSync(pricingPath), "application/json");

  // Walk WORK/data and mirror every file back under STATE_PREFIX/data/.
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (dir, base) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${base}${name}/`);
      else putQueue.push([`${STATE_PREFIX}/${base}${name}`, p]);
    }
  };
  const putQueue = [];
  walk(join(WORK, "data"), "data/");
  for (const [key, p] of putQueue) await putObject(key, readFileSync(p), "application/json");
}

// ---------- deploy page to the site bucket + invalidate ----------
async function deploy() {
  const dist = join(WORK, "dist");
  const html = readFileSync(join(dist, "bedrock-pricing.html"));
  const br = readFileSync(join(dist, "bedrock-pricing.html.br"));
  const gz = readFileSync(join(dist, "bedrock-pricing.html.gz"));
  const cache = "public, max-age=300";
  const ct = "text/html; charset=utf-8";
  await s3.send(new PutObjectCommand({ Bucket: SITE_BUCKET, Key: "index.html", Body: html, ContentType: ct, CacheControl: cache }));
  await s3.send(new PutObjectCommand({ Bucket: SITE_BUCKET, Key: "index.html.br", Body: br, ContentType: ct, ContentEncoding: "br", CacheControl: cache }));
  await s3.send(new PutObjectCommand({ Bucket: SITE_BUCKET, Key: "index.html.gz", Body: gz, ContentType: ct, ContentEncoding: "gzip", CacheControl: cache }));
  const inv = await cf.send(new CreateInvalidationCommand({
    DistributionId: DIST_ID,
    InvalidationBatch: {
      CallerReference: `refresh-${Date.now()}`,
      Paths: { Quantity: 3, Items: ["/index.html", "/", "/index.html.br"] },
    },
  }));
  return inv.Invalidation?.Id;
}

// Tiny heartbeat the page reads to show "마지막 확인". Written on EVERY successful
// run (changed or not) so it advances even when pricing data did not move. A
// failed run never writes it, so the shown time is always a real success.
// max-age=60 lets CloudFront refresh it without an invalidation.
async function publishStatus(result, flags) {
  const body = JSON.stringify({
    last_checked_at: new Date().toISOString(),
    result,
    offer_changed: !!flags.offer_changed,
    page_changed: !!flags.page_changed,
    docs_changed: !!flags.docs_changed,
  });
  await s3.send(new PutObjectCommand({
    Bucket: SITE_BUCKET, Key: "status.json", Body: body,
    ContentType: "application/json; charset=utf-8", CacheControl: "public, max-age=60",
  }));
}

export async function handler(event = {}) {
  // The invoke payload wins over the env default ("false" is a truthy string,
  // so `env || event` would always ignore event.force).
  const force = String(event.force ?? process.env.FORCE ?? "") === "true";
  await hydrate();

  const flags = parseFlags(run("check-sources.mjs"));
  const changed = flags.offer_changed || flags.page_changed || flags.docs_changed;
  if (!changed && !force) {
    // Nothing moved. Persist only if check-sources refreshed etags/state.
    if (flags.state_dirty) await persistState();
    await publishStatus("unchanged", flags);
    return { status: "unchanged", flags };
  }

  // Capture the currently-deployed dataset BEFORE the collect chain overwrites
  // web/pricing.json — the gate compares previous vs new.
  const prev = join(WORK, "prev-pricing.json");
  const curPricing = join(WORK, "web", "pricing.json");
  if (existsSync(curPricing)) writeFileSync(prev, readFileSync(curPricing));

  // Rebuild dataset (same order as the GitHub workflow).
  run("collect-english-pricing.mjs");
  run("collect-english-docs.mjs");
  run("collect-model-card-pricing.mjs");
  if (flags.offer_changed || force) {
    run("collect.mjs", ["all"]);
    run("parse-abfm.mjs", ["all"]);
  }
  run("merge.mjs");

  // Publish gate + lifecycle audit (same as the workflow), then re-inline and compress.
  if (existsSync(prev)) {
    run("gate.mjs", [prev, "web/pricing.json"]);
    run("audit-model-catalog.mjs", [prev, "web/pricing.json"]);
  }
  run("build-standalone.mjs", ["--src", "app/dist/index.html", "--out", "dist/bedrock-pricing.html"]);
  run("precompress.mjs");

  const invalidationId = await deploy();
  await persistState();
  await publishStatus("deployed", flags);
  return { status: "deployed", flags, invalidationId };
}
