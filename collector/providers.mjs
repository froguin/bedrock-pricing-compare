/**
 * Canonical provider labels, shared by both parsers.
 *
 * The two offer files disagree with themselves: AmazonBedrock sometimes carries a
 * `provider` attribute ("Mistral", "Kimi AI") and sometimes nothing, in which case
 * the name is inferred ("Mistral AI", "Moonshot AI"). That produced 19 vendor
 * labels for ~14 real vendors and made every vendor-facet count wrong.
 *
 * Some SKUs carry no usable provider hint at all and previously fell through to
 * "Unknown"; those are resolved from the model name instead.
 */

const ALIASES = {
  "mistral ai": "Mistral",
  "mistral": "Mistral",
  "kimi ai": "Moonshot AI",
  "moonshot": "Moonshot AI",
  "moonshot ai": "Moonshot AI",
  "ai21": "AI21 Labs",
  "ai21 labs": "AI21 Labs",
  "stability": "Stability AI",
  "stability ai": "Stability AI",
  "z ai": "Z AI",
  "zai": "Z AI",
  "minimax": "Minimax AI",
  "minimax ai": "Minimax AI",
  "nvidia": "Nvidia",
  "writer": "Writer",
  "twelvelabs": "TwelveLabs",
  "luma": "Luma AI",
  "luma ai": "Luma AI",
};

// model-name -> provider, for SKUs with no provider hint at all
const BY_MODEL_NAME = [
  [/palmyra/i, "Writer"],
  [/twelvelabs|pegasus|marengo/i, "TwelveLabs"],
  [/luma|ray\s?v?2/i, "Luma AI"],
  [/claude/i, "Anthropic"],
  [/nova|titan/i, "Amazon"],
  [/llama/i, "Meta"],
  [/mistral|mixtral|pixtral|voxtral|magistral|devstral/i, "Mistral"],
  [/command|cohere|embed-/i, "Cohere"],
  [/jamba|jurassic/i, "AI21 Labs"],
  [/gpt|openai/i, "OpenAI"],
  [/grok/i, "xAI"],
  [/gemma|gemini/i, "Google"],
  [/deepseek/i, "DeepSeek"],
  [/qwen/i, "Qwen"],
  [/kimi/i, "Moonshot AI"],
  [/nemotron/i, "Nvidia"],
  [/glm/i, "Z AI"],
  [/stable|sdxl/i, "Stability AI"],
];

/** Fold a raw provider label (and the model name as a fallback) to one canonical name. */
export function canonProvider(provider, modelId = "") {
  const raw = (provider || "").trim();
  if (raw && raw.toLowerCase() !== "unknown") {
    return ALIASES[raw.toLowerCase()] || raw;
  }
  for (const [re, name] of BY_MODEL_NAME) if (re.test(modelId)) return name;
  return "Unknown";
}

// Words that must keep a fixed casing when a raw id is turned into a display name.
const WORD_CASE = {
  gpt: "GPT", oss: "OSS", llm: "LLM", moe: "MoE", ai: "AI", xai: "xAI",
  grok: "Grok", gemma: "Gemma", gemini: "Gemini", qwen: "Qwen", nova: "Nova",
  llama: "Llama", mistral: "Mistral", mixtral: "Mixtral", deepseek: "DeepSeek",
  nemotron: "Nemotron", claude: "Claude", titan: "Titan", kimi: "Kimi",
  jamba: "Jamba", command: "Command", embed: "Embed", next: "Next",
  micro: "Micro", lite: "Lite", pro: "Pro", premier: "Premier",
  sonnet: "Sonnet", haiku: "Haiku", opus: "Opus", instant: "Instant",
};

/**
 * Turn a raw API-style model id into something a person reads.
 *   "xai.grok-4.6"            -> "Grok 4.6"
 *   "google.gemma-4-26b-a4b"  -> "Gemma 4 26B A4B"
 *   "openai.gpt-5.4"          -> "GPT 5.4"
 *   "qwen3-next-80b-a3b"      -> "Qwen3 Next 80B A3B"
 * A name that is already human ("Claude Sonnet 4.5") is returned untouched, so
 * this only ever fires on the handful of SKUs that carry a bare id.
 */
export function prettyModelId(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw) return raw;
  // already human: contains a space and no dotted provider prefix / kebab id
  const looksRaw = /^[a-z0-9]+\.[a-z0-9]/.test(raw) || (/^[a-z0-9]+(-[a-z0-9.]+)+$/.test(raw));
  if (!looksRaw) return raw;

  const body = raw.replace(/^[a-z0-9]+\.(?=[a-z])/, "");   // drop provider prefix
  return body
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => {
      if (/^\d+(\.\d+)?$/.test(w)) return w;                       // version number
      if (/^[a-z]?\d+(\.\d+)?b$/i.test(w)) return w.toUpperCase(); // 80b, a3b, e2b
      // a word with a trailing digit run, e.g. "qwen3"
      const m = w.match(/^([a-z]+)(\d+)$/i);
      if (m) {
        const base = WORD_CASE[m[1].toLowerCase()] || (m[1][0].toUpperCase() + m[1].slice(1));
        return base + m[2];
      }
      return WORD_CASE[w.toLowerCase()] || (w[0].toUpperCase() + w.slice(1));
    })
    .join(" ");
}
