import test from "node:test";
import assert from "node:assert/strict";
import { initRum } from "./rum.js";

test("RUM stays completely off outside the production hostname", () => {
  globalThis.location = { hostname: "localhost" };
  globalThis.window = {};
  assert.equal(initRum(), false);
  assert.equal(window.AwsRumClient, undefined);
});

test("RUM production loader is unsigned, sampled and alias-bound", () => {
  let script;
  globalThis.location = { hostname: "bedrock-compare.awskr.net" };
  globalThis.window = {};
  globalThis.document = {
    createElement: () => (script = {}),
    head: { firstChild: null, insertBefore: () => {} },
  };
  assert.equal(initRum(), true);
  assert.match(script.src, /client\.rum\.us-east-1\.amazonaws\.com\/3\.2\.1\/cwr\.js/);
  assert.equal(window.AwsRumClient.c.signing, false);
  assert.equal(window.AwsRumClient.c.alias, "bedrock-compare-web-v1");
  assert.equal(window.AwsRumClient.c.sessionSampleRate, 0.1);
  assert.deepEqual(window.AwsRumClient.c.telemetries, ["errors", "performance", "http"]);
});
