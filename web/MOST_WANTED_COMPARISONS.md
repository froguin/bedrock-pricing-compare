# Most-Wanted Comparisons — Design

All figures are $/1M tokens, computed from `web/pricing.json`
(offer_version 20260917231609), canonical slice unless noted:
**status=ga, execution_mode=online, service_tier=standard, endpoint=in-region, region=us-east-1**.
`blend3 = 3×input + 1×output` (a read-heavy 3:1 workload, the common realistic mix).

## 1. Comparisons users most want (backed by real numbers)

### A. Claude tier ladder (within-family) — the single most-requested view
| Model | input | output | blend3 |
|---|---|---|---|
| Claude Haiku 4.5 | 1.1 | 5.5 | 8.80 |
| Claude Sonnet 4.5 | 3.3 | 16.5 | 26.40 |
| Claude Opus 4.5 | 5.5 | 27.5 | 44.00 |
Opus is exactly 5× Haiku on blend3. This is the "which Claude do I use" decision.

### B. Cross-vendor frontier (flagship shootout)
| Model | input | output | blend3 |
|---|---|---|---|
| Anthropic Claude Sonnet 4.5 | 3.3 | 16.5 | 26.40 |
| xAI Grok 4.6 | 2.2 | 6.6 | 13.20 |
| Amazon Nova 2.0 Pro | 1.375 | 11 | 15.13 |
| DeepSeek v3.2 | 0.62 | 1.85 | 3.71 |
| Meta Llama 4 Maverick 17B | 0.24 | 0.97 | 1.69 |
| OpenAI GPT OSS Safeguard 120B | 0.15 | 0.6 | 1.05 |
Claude Sonnet 4.5 costs **25×** the cheapest frontier option (GPT OSS 120B).

### C. Cheapest-per-1M overall (the "budget floor")
| Model | input | output | blend3 |
|---|---|---|---|
| Mistral Voxtral Mini 1.0 | 0.04 | 0.04 | 0.16 |
| Google Gemma 3 4B | 0.04 | 0.08 | 0.20 |
| Amazon Nova Micro | 0.035 | 0.14 | 0.245 |
| Meta Llama 3.2 1B | 0.10 | 0.10 | 0.40 |

### D. Generation upgrade (should I move up?) — Nova
Nova Pro (0.8/3.2, blend $5.60) → Nova 2.0 Pro (1.375/11, blend $15.13): the new
generation is **2.7× more expensive** on blend3. A genuinely surprising, decision-relevant fact.

### E. In-region vs global-CRIS (same model, cheaper routing)
For every model that offers both, global-CRIS is a flat **~9.1% cheaper** (see §2).

## 2. Headline insights (compute-verified)

1. **750× price spread across GA models.** Most expensive GA blend3 = Claude 3 Opus
   $120.00 (15/75); cheapest = Mistral Voxtral Mini 1.0 $0.16 (0.04/0.04). Output
   alone spans $0.04 → $75 = 1,875×.
2. **Opus got 63% cheaper by generation.** Claude 3/4/4.1 Opus all price 15/75
   (blend $120); Claude Opus 4.5 is 5.5/27.5 (blend $44) — a **$76/blend drop**,
   the biggest single headline in the set.
3. **global-CRIS = flat 9.1% off, almost universally.** Claude Sonnet 4.5, Sonnet 4.6,
   Opus 4.5, Haiku 4.5, Grok 4.6, Kimi K3, Nova 2.0 Pro all save exactly 9.1% on blend3.
   Exception worth flagging: **Claude Sonnet 4** saves 0.0% (IR and GC both blend $24) —
   a real quirk in the data.
4. **Output is where the money is.** Biggest output:input multiplier among GA models:
   Writer Palmyra X5 10× (0.6→6), Amazon Nova 2.0 Omni/Lite 9×, Qwen3 Next 80B 9×.
   Nova Sonic (speech) is the extreme: input 0.06, output 13.6 = **227×**.
5. **Same model, same price almost everywhere.** Claude Sonnet 4.5 input is $3.3 in 18
   of 20 regions; only the two GovCloud regions (us-gov-east-1, us-gov-west-1) charge
   a premium at $3.6 = **+9%**. Region choice barely matters for price; endpoint_type
   (CRIS) and model choice dominate. (Do NOT rank regions by mean price — thin-coverage
   regions like af-south-1 carry only 2 expensive SKUs and produce a misleading $2.75 mean.)

## 3. Preset comparison buttons (4–6 featured)

1. **"Claude: Haiku vs Sonnet vs Opus 4.5"** — {Claude Haiku 4.5, Claude Sonnet 4.5,
   Claude Opus 4.5}. The tier-ladder decision, exact 5× span. Most-clicked by intent.
2. **"Frontier shootout"** — {Claude Sonnet 4.5, Amazon Nova 2.0 Pro, xAI Grok 4.6,
   Meta Llama 4 Maverick, DeepSeek v3.2, OpenAI GPT OSS 120B}. Cross-vendor flagship
   value; headline "25× spread at the frontier."
3. **"Cheapest per 1M"** — {Mistral Voxtral Mini 1.0, Gemma 3 4B, Nova Micro,
   Llama 3.2 1B}. The budget floor for high-volume/simple workloads.
4. **"In-region vs global-CRIS"** — {Claude Sonnet 4.5, Claude Opus 4.5, Nova 2.0 Pro}
   shown side-by-side across both endpoint types. Teaches the flat 9.1% saving.
5. **"Opus across generations"** — {Claude 3 Opus, Claude Opus 4, Claude Opus 4.1,
   Claude Opus 4.5}. Surfaces the $120→$44 collapse; strongest "wow" fact.
6. **"Amazon Nova: gen 1 vs gen 2"** — {Nova Micro, Nova Lite, Nova Pro, Nova 2.0 Lite,
   Nova 2.0 Pro}. Shows the new generation costs more, not less — counterintuitive.
