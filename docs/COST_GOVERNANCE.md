# Cost governance

MCP Guardian estimates LLM spend from proxied `tools/call` traffic. All monetary values are **USD only**; there is no FX conversion.

## Token counting

| Provider | Method | Typical drift vs billed usage |
|----------|--------|-------------------------------|
| OpenAI (`gpt-*`, `o1`, `o3`, `o4`) | `tiktoken` (`o200k_base` / `cl100k_base`) | ~±2% |
| Anthropic (`claude-*`) | `@anthropic-ai/tokenizer` (optional) or chars÷3.5 | ~±5–7% without API usage |
| Google (`gemini-*`, `gemma-*`) | litellm when installed, else char-ratio | varies |
| Other | litellm or char-ratio by prefix | varies |

Install the optional Anthropic tokenizer for better Claude estimates:

```bash
pnpm add @anthropic-ai/tokenizer
# or: npm install @anthropic-ai/tokenizer
```

When the upstream response (or MCP `_meta`) includes `usage: { input_tokens, output_tokens }` (Anthropic/OpenAI shape), Guardian **prefers those counts** and sets `tokenSource: api` on the call record. Otherwise counts are `tokenSource: estimated`.

If API usage and the local estimate diverge by more than **5%**, Guardian logs a warning: `[token-counter] … drift=…%`.

## Multimodal (images)

Image blocks in tool arguments or results contribute additional tokens using the OpenAI-style rule:

```
tokens ≈ ceil((width × height) / 750)
```

Detected shapes include `width`/`height`, `image_url` data URLs, and `type: image` content blocks. Base64 images without dimensions assume 1024×1024.

## Pricing

Rates come from Cline state, `GUARDIAN_MODEL` / env, or litellm-backed lookups (`RuntimeModelPricing`). Example Claude 3.5 Sonnet table entry: **$3.00 / M input**, **$15.00 / M output** (see `src/clients/pricing-client.ts`).

## Expectations (Test 5 reference)

- **GPT-4o**: low drift when using tiktoken alone.
- **Claude 3.5 Sonnet**: use Anthropic tokenizer or API `usage` to avoid OpenAI BPE skew (~7% without).
- **Multimodal**: image tokens must be non-zero when width/height or image URLs are present.
- **Currency**: reports and dashboards show USD only; multi-currency is not supported.
