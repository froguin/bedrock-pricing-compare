// CloudWatch RUM: credential-free ingestion via the app monitor's resource policy.
// Only the production hostname loads the client; local/file previews emit nothing.
const HOST = "bedrock-compare.awskr.net";
const APP_MONITOR_ID = "56aa4001-dd42-449f-8520-7481ff061825";
const REGION = "ap-northeast-2";
const CLIENT = "https://client.rum.us-east-1.amazonaws.com/3.2.1/cwr.js";

export function initRum() {
  if (location.hostname !== HOST || window.AwsRumClient) return false;
  ((n, i, v, r, s, c, u, x, z) => {
    x = window.AwsRumClient = { q: [], n, i, v, r, c, u };
    window[n] = (command, payload) => x.q.push({ c: command, p: payload });
    z = document.createElement("script");
    z.async = true;
    z.src = s;
    // The AWS CDN serves this classic script without CORS headers. Setting
    // crossOrigin would make browsers reject it (caught by Lighthouse).
    document.head.insertBefore(z, document.head.firstChild);
  })("cwr", APP_MONITOR_ID, "1.0.0", REGION, CLIENT, {
    signing: false,
    alias: "bedrock-compare-web-v1",
    sessionSampleRate: 0.1,
    endpoint: `https://dataplane.rum.${REGION}.amazonaws.com`,
    telemetries: ["errors", "performance", "http"],
    allowCookies: true,
  });
  return true;
}
