#!/usr/bin/env node
// Pre-compress the single-file page at maximum quality. CloudFront's on-the-fly
// Brotli is a fast, low-quality pass (~650 KB for this page); Brotli 11 gets
// ~460 KB. The CloudFront viewer-request function (infra/cf-precompressed.js)
// serves index.html.br / .gz / plain by the visitor's Accept-Encoding.
//
//   node collector/precompress.mjs  ->  dist/bedrock-pricing.html.br, .gz

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants as Z } from "node:zlib";

const ROOT = process.env.BPC_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "dist/bedrock-pricing.html");
const buf = readFileSync(SRC);

const br = brotliCompressSync(buf, {
  params: {
    [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT,
    [Z.BROTLI_PARAM_QUALITY]: Z.BROTLI_MAX_QUALITY,
    [Z.BROTLI_PARAM_SIZE_HINT]: buf.length,
  },
});
const gz = gzipSync(buf, { level: 9 });
writeFileSync(SRC + ".br", br);
writeFileSync(SRC + ".gz", gz);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`precompress: raw ${kb(buf.length)} · br ${kb(br.length)} · gzip ${kb(gz.length)}`);
