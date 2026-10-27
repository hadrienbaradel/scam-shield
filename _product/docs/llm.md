Keywords: llm, provider, model, muse, openai, anthropic, ollama

# The LLM layer (lib/llm)

Every AI check is one model call through `lib/llm`, so the model can change without touching the prompts, the redaction, the guardrails, the schema checks or the cache (all in `lib/muse.js`). Meta's Muse Spark on the Meta Model API is the default and what the demo shows.

## Switching providers

Set keys with `make secrets-set KEY=value` (`_product/docs/secrets.md`); providers read the environment on every call, so a change applies to the next request (restart the server anyway so `/api/status` and the startup line agree).

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `meta` (default; alias `muse`), `anthropic` (alias `claude`), `openai`, `groq`, `together`, `ollama`, `llama-api`, `openai-compatible`, `mock` |
| `LLM_MODEL` | Model id for the selected provider. Defaults: `muse-spark-1.3`, `claude-opus-5-5`, `gpt-4o-mini`, `llama-3.3-70b-versatile`, `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `llama3.2`, `Llama-4-Maverick-17B-128E-Instruct-FP8`; `openai-compatible` has none |
| `LLM_BASE_URL` | Address of an OpenAI-compatible endpoint (any `/v1` that serves `chat/completions`); overrides the preset address |
| `LLM_THINKING` | Reasoning effort for any provider: `minimal`, `low`, `medium`, `high`; `off` sends none |
| `META_MODEL_API_KEY`, `META_MODEL_NAME`, `META_MODEL_BASE_URL`, `META_MODEL_REASONING_EFFORT` | Muse Spark, unchanged (effort default `low`; a `-contributor` model id is refused) |
| `OPENAI_API_KEY` | Key for every OpenAI-compatible provider; not needed for `ollama` or a custom `LLM_BASE_URL` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Claude (Messages API, version 2026-10-21) |

Examples: `LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=...`; `LLM_PROVIDER=ollama LLM_MODEL=llama3.2`; `LLM_PROVIDER=groq OPENAI_API_KEY=... LLM_MODEL=llama-3.3-70b-versatile`; `LLM_PROVIDER=openai-compatible LLM_BASE_URL=http://host:8080/v1 LLM_MODEL=...`.
The verdict's `source` names who judged: `Muse Spark (muse-spark-1.3)`, `Claude (claude-opus-5-5)`, `Groq (...)`, or `detector (<provider> unavailable)` with `degraded: true` when the model failed and the detector answered.

## Interface

```js
import { complete, getProvider, llmConfigured, llmModel } from "./lib/llm/index.js";
const { text, usage, model, provider, raw } = await complete({
  system, messages: [{ role: "user", content: "..." | [{ type: "text", text }, { type: "image", mime, base64 }] }],
  maxTokens, temperature, json: { name, schema }, thinking: "low", signal: AbortSignal.timeout(20000) });
```
`complete` throws on any failure (HTTP error, refusal, a thinking budget spent with no answer); the engine catches, counts it on the circuit breaker and falls back to the detector. `usage` is the provider's own object (`prompt_tokens`/`completion_tokens` or `input_tokens`/`output_tokens`; `scripts/muse-file-cache.mjs` reads both).

## Capability matrix and degradation

| | meta (Muse Spark) | openai-style (openai, groq, together, ollama, llama-api, openai-compatible) | anthropic | mock |
|---|---|---|---|---|
| JSON schema | `response_format: json_schema`; resent without it on a 400 | same | `output_config.format` with the schema trimmed to the supported subset (no `maxLength`/`minimum`/`maxItems`, `additionalProperties: false` everywhere); resent without it on a 400 | recorded |
| thinking | `reasoning_effort`, default `low`; dropped on a 400 | `reasoning_effort` only when `LLM_THINKING` is set; dropped on a 400 | `output_config.effort`, default `low`; dropped on a 400; adaptive thinking stays on | recorded |
| temperature | 0.1 | 0.1; dropped on a 400 (reasoning models); `max_tokens` becomes `max_completion_tokens` on request | never sent (the API rejects sampling parameters) | recorded |
| images | yes | depends on the model | yes | yes |

Without native JSON the prompts still say "return only JSON", the engine parses the first `{...}` in the text and validates it against the full verdict schema (`lib/schema.js`); anything invalid falls back to the detector.

## Adding a provider (3 steps)

1. Create `lib/llm/<name>.js` exporting `create<Name>Provider({ fetchImpl })` that returns `{ name, label, capabilities, configured(), model(), defaultThinking(), complete(request) }`. `complete` turns the neutral request into the wire format, returns `{ text, usage, model, provider, raw }` and throws on failure. Read `process.env` inside the functions, use the injected `fetchImpl` or `globalThis.fetch` at call time, and pass `signal` through.
2. Register it in `FACTORIES` in `lib/llm/index.js` (plus an alias in `ALIASES` if useful) and add a row to the matrix above.
3. Add tests to `tests/llm.test.js` with an injected fetch: request shape, response parsing, the 400 fallbacks, error wording. `npm test` must stay green.

## Where prompts live

`prompts/scam-shield-system.md` (the verdict system prompt, `PROMPT_VERSION` in `lib/muse.js` is part of the cache key), `buildUserPrompt`, `IMAGE_PROMPT` and `CARD_PROMPT` in `lib/muse.js`. Adapters never add prompt text.

## The mock provider in tests

`LLM_PROVIDER=mock` routes the engine to one shared instance, `getProvider("mock")`: `mock.script(answer, ...)` queues answers (an object is sent as JSON text, a string as is, a function receives `(request, callNumber)`, an `Error` is thrown), `mock.respondWith(fn)` answers what the script does not cover, `mock.calls[i]` holds every request (`system`, `messages`, `json`, `maxTokens`, `temperature`, `thinking`, `signal`), and `mock.reset()` clears all of it (do it in `afterEach`). `createMockProvider()` gives a private instance for unit tests. Adapter tests inject `fetchImpl` into `createMetaProvider` and friends and never touch the network.
