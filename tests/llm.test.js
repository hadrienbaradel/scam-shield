// lib/llm: provider selection, each adapter's request shaping and response
// parsing with an injected fetch (no network), the mock provider, and the
// engine (lib/muse.js) running through the layer.
import "./helpers/env.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getProvider, llmConfigured, llmModel, llmLabel, llmThinking, providerName, capabilities, PROVIDER_NAMES, toolsConfigured } from "../lib/llm/index.js";
import { createMetaProvider, allowContributorForPublicEval } from "../lib/llm/meta.js";
import { createOpenAiCompatibleProvider, toOpenAiMessages, parseToolCalls } from "../lib/llm/openai-compatible.js";
import { createAnthropicProvider, API_VERSION } from "../lib/llm/anthropic.js";
import { createMockProvider } from "../lib/llm/mock.js";
import { checkMessage, extractFromImage, museChat, breaker } from "../lib/muse.js";
import { VERDICT_SCHEMA } from "../lib/schema.js";

const ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_THINKING", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
  "META_MODEL_API_KEY", "META_MODEL_NAME", "META_MODEL_BASE_URL", "META_MODEL_REASONING_EFFORT", "BASETEN_API_KEY"];
const clean = () => { for (const k of ENV) delete process.env[k]; breaker.failures = 0; breaker.openUntil = 0; getProvider("mock").reset(); };
beforeEach(clean);
afterEach(clean);

// A fetch that records every request and answers from a script: each entry
// is { status, json } or a function of (body, callNumber); the last repeats.
const ok = (json) => ({ status: 200, json });
const bad = (status, message) => ({ status, json: { error: { message } } });
const chat = (content, extra = {}) => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop", ...extra }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
function fakeFetch(script) {
  const calls = [];
  const queue = [].concat(script);
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, opts, body, headers: opts.headers });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const r = typeof next === "function" ? next(body, calls.length) : next;
    return new Response(JSON.stringify(r.json), { status: r.status });
  };
  return { fetchImpl, calls };
}
const VERDICT = { verdict: "be_careful", confidence: 0.8, headline: "x", reasons: [{ text: "r", evidence: "sender" }], action: "check_official_website", action_text: "a",
  real_company_says: null, impersonated_brand: null, scam_type: null, matched_pattern_ids: [], escalate_to_guardian: false, guardian_summary: null, language: "en" };
const plain = { locale: "en-US", message: { channel: "email", from: "a@b.test", fromName: "A", subject: "s", body: "hello", links: [] }, personalContext: null, patternCards: [] };

test("selection: Muse Spark on the Meta Model API is the default; names, aliases and mistakes", () => {
  assert.equal(getProvider().name, "meta");
  assert.equal(llmLabel(), "Muse Spark");
  assert.equal(llmModel(), "muse-spark-1.3");
  process.env.LLM_PROVIDER = "claude";
  assert.equal(getProvider().name, "anthropic");
  assert.equal(llmModel(), "claude-opus-5-5");
  process.env.LLM_PROVIDER = "Groq";
  assert.equal(getProvider().label, "Groq");
  assert.equal(providerName("muse"), "meta");
  assert.equal(getProvider("anthropic"), getProvider("claude"), "one instance per provider");
  assert.deepEqual(Object.keys(capabilities()).sort(), [...PROVIDER_NAMES].sort());
  process.env.LLM_PROVIDER = "nope";
  assert.throws(() => getProvider(), /Unknown LLM provider "nope"/);
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    assert.equal(llmConfigured(), false, "a misspelt provider means detector only");
    assert.equal(llmConfigured(), false);
    assert.equal(warned.length, 1, "said once");
  } finally { console.warn = warn; }
  assert.equal(llmLabel(), "LLM");
});

test("selection: configured means the selected provider has what it needs", () => {
  assert.equal(llmConfigured(), false);
  process.env.META_MODEL_API_KEY = "k";
  assert.equal(llmConfigured(), true);
  process.env.LLM_PROVIDER = "anthropic";
  assert.equal(llmConfigured(), false);
  process.env.ANTHROPIC_API_KEY = "a";
  assert.equal(llmConfigured(), true);
  process.env.LLM_PROVIDER = "openai";
  assert.equal(llmConfigured(), false);
  process.env.OPENAI_API_KEY = "o";
  assert.equal(llmConfigured(), true);
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_PROVIDER = "ollama";
  assert.equal(llmConfigured(), true, "a local endpoint needs no key");
  process.env.LLM_PROVIDER = "openai-compatible";
  assert.equal(llmConfigured(), false, "the generic endpoint needs a model and an address or key");
  process.env.LLM_MODEL = "m";
  assert.equal(llmConfigured(), false);
  process.env.LLM_BASE_URL = "http://localhost:8080/v1";
  assert.equal(llmConfigured(), true);
  process.env.LLM_PROVIDER = "mock";
  assert.equal(llmConfigured(), true);
});

test("thinking: Muse keeps its tuned default, LLM_THINKING overrides any provider, off sends none", () => {
  assert.equal(llmThinking(), "low");
  process.env.META_MODEL_REASONING_EFFORT = "minimal";
  assert.equal(llmThinking(), "minimal");
  process.env.LLM_THINKING = "high";
  assert.equal(llmThinking(), "high");
  process.env.LLM_THINKING = "off";
  assert.equal(llmThinking(), undefined);
  delete process.env.LLM_THINKING;
  process.env.LLM_PROVIDER = "openai";
  assert.equal(llmThinking(), undefined, "OpenAI-style endpoints get no effort unless asked");
  process.env.LLM_PROVIDER = "anthropic";
  assert.equal(llmThinking(), "low");
});

test("meta: the request is byte for byte what lib/muse.js sent before the provider layer", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const { fetchImpl, calls } = fakeFetch(ok(chat({ verdict: "safe" })));
  const meta = createMetaProvider({ fetchImpl });
  const out = await meta.complete({ system: "SYS", messages: [{ role: "user", content: "<message>{}</message>" }],
    maxTokens: 4000, temperature: 0.1, thinking: "low", json: { name: "scam_shield_verdict", schema: VERDICT_SCHEMA } });
  // The body as the previous museChat built it: model, messages (system
  // first), temperature 0.1, max_tokens, reasoning_effort, response_format.
  const before = JSON.stringify({
    model: "muse-spark-1.3",
    messages: [{ role: "system", content: "SYS" }, { role: "user", content: "<message>{}</message>" }],
    temperature: 0.1, max_tokens: 4000, reasoning_effort: "low",
    response_format: { type: "json_schema", json_schema: { name: "scam_shield_verdict", schema: VERDICT_SCHEMA, strict: false } },
  });
  assert.equal(calls[0].opts.body, before);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(calls[0].headers, { "content-type": "application/json", authorization: "Bearer test-key" });
  assert.deepEqual(out, { text: '{"verdict":"safe"}', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model: "muse-spark-1.3", provider: "meta", raw: chat({ verdict: "safe" }) });

  // A screenshot: the neutral image part becomes the data URL sent before.
  await meta.complete({ system: "P", messages: [{ role: "user", content: [{ type: "text", text: "Transcribe this message." }, { type: "image", mime: "image/png", base64: "aGVsbG8=" }] }], maxTokens: 4000, temperature: 0.1, thinking: "low" });
  assert.equal(calls[1].opts.body, JSON.stringify({
    model: "muse-spark-1.3",
    messages: [{ role: "system", content: "P" }, { role: "user", content: [{ type: "text", text: "Transcribe this message." }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] }],
    temperature: 0.1, max_tokens: 4000, reasoning_effort: "low",
  }));
  // No schema, no effort: nothing extra is sent (pattern cards).
  await meta.complete({ system: "P", messages: [{ role: "user", content: "alert" }], maxTokens: 4000, temperature: 0.1 });
  assert.equal(calls[2].opts.body, JSON.stringify({ model: "muse-spark-1.3", messages: [{ role: "system", content: "P" }, { role: "user", content: "alert" }], temperature: 0.1, max_tokens: 4000 }));
  // META_MODEL_BASE_URL and the model name still apply; LLM_MODEL wins.
  process.env.META_MODEL_BASE_URL = "https://proxy.example/v1/";
  process.env.META_MODEL_NAME = "muse-spark-1.4";
  await meta.complete({ messages: [] });
  assert.equal(calls[3].url, "https://proxy.example/v1/chat/completions");
  assert.equal(calls[3].body.model, "muse-spark-1.4");
  process.env.LLM_MODEL = "muse-spark-2";
  await meta.complete({ messages: [] });
  assert.equal(calls[4].body.model, "muse-spark-2");
});

test("meta: retries without reasoning_effort, then without response_format, as before", async () => {
  process.env.META_MODEL_API_KEY = "k";
  const { fetchImpl, calls } = fakeFetch((body) => body.reasoning_effort ? bad(400, "Unknown parameter: reasoning_effort")
    : body.response_format ? bad(400, "response_format not supported") : ok(chat('Here: {"a":1}')));
  const out = await createMetaProvider({ fetchImpl }).complete({ messages: [{ role: "user", content: "x" }], thinking: "low", json: { name: "r", schema: { type: "object" } } });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].body.reasoning_effort && calls[0].body.response_format);
  assert.ok(!calls[1].body.reasoning_effort && calls[1].body.response_format);
  assert.ok(!calls[2].body.reasoning_effort && !calls[2].body.response_format);
  assert.equal(out.text, 'Here: {"a":1}');
  // Other 400s are not retried.
  const second = fakeFetch(bad(400, "model not found"));
  await assert.rejects(createMetaProvider({ fetchImpl: second.fetchImpl }).complete({ messages: [], thinking: "low" }), /^Error: Meta Model API 400: model not found$/);
  assert.equal(second.calls.length, 1);
});

test("meta: errors keep their wording, Contributor mode is refused before any request", async () => {
  process.env.META_MODEL_API_KEY = "k";
  await assert.rejects(createMetaProvider({ fetchImpl: fakeFetch(bad(500, "boom")).fetchImpl }).complete({ messages: [] }), /^Error: Meta Model API 500: boom$/);
  await assert.rejects(createMetaProvider({ fetchImpl: fakeFetch({ status: 503, json: {} }).fetchImpl }).complete({ messages: [] }), /^Error: Meta Model API 503:$/);
  const spent = ok({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { completion_tokens_details: { reasoning_tokens: 898 } } });
  await assert.rejects(createMetaProvider({ fetchImpl: fakeFetch(spent).fetchImpl }).complete({ messages: [], maxTokens: 900 }),
    /^Error: Muse Spark spent its whole 900-token budget thinking and gave no answer \(reasoning 898 tokens\)$/);
  const parts = ok({ choices: [{ message: { content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }] } }] });
  assert.equal((await createMetaProvider({ fetchImpl: fakeFetch(parts).fetchImpl }).complete({ messages: [] })).text, '{"a":1}');
  const { fetchImpl, calls } = fakeFetch(ok(chat("x")));
  process.env.META_MODEL_NAME = "muse-spark-1.3-contributor";
  await assert.rejects(createMetaProvider({ fetchImpl }).complete({ messages: [] }), /Refusing Contributor-mode model muse-spark-1.3-contributor/);
  assert.equal(calls.length, 0);
});

test("meta: Contributor only after allowContributorForPublicEval (public-corpus evaluation), refused again once it is off", async () => {
  process.env.META_MODEL_API_KEY = "k";
  process.env.META_MODEL_NAME = "muse-spark-1.3-contributor";
  const refused = fakeFetch(ok(chat("x")));
  await assert.rejects(createMetaProvider({ fetchImpl: refused.fetchImpl }).complete({ messages: [] }), /Refusing Contributor-mode/);
  allowContributorForPublicEval();
  try {
    const { fetchImpl, calls } = fakeFetch(ok(chat("x")));
    assert.equal((await createMetaProvider({ fetchImpl }).complete({ messages: [] })).text, "x");
    assert.equal(calls[0].body.model, "muse-spark-1.3-contributor");
  } finally { allowContributorForPublicEval(false); }
  await assert.rejects(createMetaProvider({ fetchImpl: refused.fetchImpl }).complete({ messages: [] }), /Refusing Contributor-mode/);
  assert.equal(refused.calls.length, 0);
});

test("openai-compatible: presets, LLM_BASE_URL, a key header only with a key, LLM_MODEL", async () => {
  process.env.OPENAI_API_KEY = "sk";
  const { fetchImpl, calls } = fakeFetch(ok(chat("hi")));
  await createOpenAiCompatibleProvider({ preset: "groq", fetchImpl }).complete({ system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0.1 });
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer sk");
  assert.equal(calls[0].body.model, "llama-3.3-70b-versatile");
  assert.deepEqual(calls[0].body.messages, [{ role: "system", content: "s" }, { role: "user", content: "hi" }]);
  assert.equal(calls[0].body.temperature, 0.1);
  assert.equal(calls[0].body.max_tokens, 100);
  assert.equal("reasoning_effort" in calls[0].body, false, "no effort unless asked");
  assert.equal("response_format" in calls[0].body, false);
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_BASE_URL = "http://localhost:11434/v1/";
  process.env.LLM_MODEL = "llama3.2";
  const out = await createOpenAiCompatibleProvider({ preset: "ollama", fetchImpl }).complete({ messages: [{ role: "user", content: "hi" }], thinking: "low", json: true });
  assert.equal(calls[1].url, "http://localhost:11434/v1/chat/completions");
  assert.equal("authorization" in calls[1].headers, false);
  assert.equal(calls[1].body.model, "llama3.2");
  assert.equal(calls[1].body.reasoning_effort, "low");
  assert.deepEqual(calls[1].body.response_format, { type: "json_object" });
  assert.equal("max_tokens" in calls[1].body, false);
  assert.equal(out.provider, "ollama");
  assert.equal(out.text, "hi");
  const p = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: fakeFetch(bad(401, "bad key")).fetchImpl });
  await assert.rejects(p.complete({ messages: [] }), /^Error: OpenAI API 401: bad key$/);
});

test("openai-compatible: degrades on 400s: effort, response_format, max_completion_tokens, temperature", async () => {
  process.env.OPENAI_API_KEY = "sk";
  const { fetchImpl, calls } = fakeFetch((body) => body.reasoning_effort ? bad(400, "Unrecognized request argument supplied: reasoning_effort")
    : body.response_format ? bad(400, "'response_format' of type 'json_schema' is not supported")
    : body.max_tokens ? bad(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")
    : body.temperature !== undefined ? bad(400, "Unsupported value: 'temperature' does not support 0.1 with this model.")
    : ok(chat('{"ok":true}')));
  const out = await createOpenAiCompatibleProvider({ preset: "openai", fetchImpl }).complete({ messages: [{ role: "user", content: "x" }], maxTokens: 50, temperature: 0.1, thinking: "low", json: { name: "x", schema: { type: "object" } } });
  assert.equal(calls.length, 5);
  const last = calls[4].body;
  assert.equal(last.max_completion_tokens, 50);
  for (const k of ["max_tokens", "temperature", "reasoning_effort", "response_format"]) assert.equal(k in last, false, k);
  assert.equal(out.text, '{"ok":true}');
  assert.deepEqual(toOpenAiMessages("S", [{ role: "user", content: [{ type: "text", text: "t" }, { type: "image", mime: "image/png", base64: "aGk=" }, { type: "other", x: 1 }] }]),
    [{ role: "system", content: "S" }, { role: "user", content: [{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }, { type: "other", x: 1 }] }]);
});

test("baseten: Muse Spark Open (open weights) on its own key, never OPENAI_API_KEY; low effort unless LLM_THINKING says otherwise", async () => {
  process.env.LLM_PROVIDER = "baseten";
  process.env.OPENAI_API_KEY = "sk-openai";
  assert.equal(llmConfigured(), false, "an OpenAI key is never sent to Baseten");
  assert.equal(llmLabel(), "Baseten");
  assert.equal(llmModel(), "meta-models/muse-spark-open-1026", "the hackathon's model id");
  assert.equal(llmThinking(), "low", "it always reasons; Baseten's own default is xhigh");
  process.env.BASETEN_API_KEY = "bt";
  assert.equal(llmConfigured(), true);
  const { fetchImpl, calls } = fakeFetch(ok(chat(VERDICT)));
  const out = await createOpenAiCompatibleProvider({ preset: "baseten", fetchImpl }).complete({ system: "s", messages: [{ role: "user", content: "hi" }],
    maxTokens: 4000, temperature: 0.1, thinking: llmThinking(), json: { name: "scam_shield_verdict", schema: VERDICT_SCHEMA } });
  assert.equal(calls[0].url, "https://inference.baseten.co/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer bt");
  assert.equal(calls[0].body.model, "meta-models/muse-spark-open-1026");
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.equal(calls[0].body.response_format.type, "json_schema", "sent; Baseten accepts it without enforcing it, so the engine's own schema check decides");
  assert.deepEqual([out.provider, JSON.parse(out.text).verdict], ["baseten", "be_careful"]);
  process.env.LLM_THINKING = "high";
  assert.equal(llmThinking(), "high");
  process.env.LLM_MODEL = "meta-models/muse-spark-open";
  assert.equal(llmModel(), "meta-models/muse-spark-open", "LLM_MODEL names another id");
  delete process.env.BASETEN_API_KEY;
  await assert.rejects(createOpenAiCompatibleProvider({ preset: "baseten", fetchImpl }).transcribe({ wav: new Uint8Array(44) }),
    { message: "Baseten API needs BASETEN_API_KEY or LLM_BASE_URL to transcribe" });
});

test("anthropic: Messages API request: key and version headers, system on top, effort, structured output, images, no sampling", async () => {
  process.env.ANTHROPIC_API_KEY = "ak";
  const answer = { content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"verdict":' }, { type: "text", text: '"safe"}' }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 3 }, model: "claude-opus-5-5" };
  const { fetchImpl, calls } = fakeFetch(ok(answer));
  const claude = createAnthropicProvider({ fetchImpl });
  const out = await claude.complete({ system: "SYS", messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", mime: "image/jpeg", base64: "aGk=" }] }],
    maxTokens: 4000, temperature: 0.1, thinking: "low", json: { name: "v", schema: VERDICT_SCHEMA } });
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(calls[0].headers, { "content-type": "application/json", "x-api-key": "ak", "anthropic-version": API_VERSION });
  const b = calls[0].body;
  assert.equal(b.model, "claude-opus-5-5");
  assert.equal(b.max_tokens, 4000);
  assert.equal(b.system, "SYS");
  assert.deepEqual(b.messages, [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGk=" } }] }]);
  assert.equal(b.output_config.effort, "low");
  const schema = b.output_config.format.schema;
  assert.equal(b.output_config.format.type, "json_schema");
  assert.equal("maxLength" in schema.properties.headline, false, "string constraints are not accepted");
  assert.equal("minimum" in schema.properties.confidence, false);
  assert.equal("maxItems" in schema.properties.reasons, false);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.reasons.items.additionalProperties, false);
  assert.deepEqual(schema.properties.verdict.enum, ["safe", "be_careful", "scam"]);
  assert.deepEqual(schema.required, VERDICT_SCHEMA.required);
  for (const k of ["temperature", "top_p", "thinking"]) assert.equal(k in b, false, k);
  assert.deepEqual(out, { text: '{"verdict":"safe"}', usage: { input_tokens: 12, output_tokens: 3 }, model: "claude-opus-5-5", provider: "anthropic", raw: answer });
  // Effort levels map; without a level or a schema no output_config is sent.
  await claude.complete({ messages: [{ role: "user", content: "x" }], thinking: "minimal" });
  assert.equal(calls[1].body.output_config.effort, "low");
  await claude.complete({ messages: [{ role: "user", content: "x" }], thinking: "medium" });
  assert.equal(calls[2].body.output_config.effort, "medium");
  await claude.complete({ messages: [{ role: "user", content: "x" }] });
  assert.equal("output_config" in calls[3].body, false);
  assert.equal(calls[3].body.max_tokens, 4096);
  process.env.ANTHROPIC_BASE_URL = "https://proxy.example/";
  process.env.LLM_MODEL = "claude-sonnet-5-5";
  await claude.complete({ messages: [] });
  assert.equal(calls[4].url, "https://proxy.example/v1/messages");
  assert.equal(calls[4].body.model, "claude-sonnet-5-5");
});

test("anthropic: a rejected schema or effort is retried without it; errors, refusals and spent budgets surface", async () => {
  process.env.ANTHROPIC_API_KEY = "ak";
  const text = (t, extra = {}) => ok({ content: [{ type: "text", text: t }], stop_reason: "end_turn", ...extra });
  const a = fakeFetch((body) => body.output_config?.format ? bad(400, "output_config.format.schema: unsupported keyword") : text("{}"));
  const out = await createAnthropicProvider({ fetchImpl: a.fetchImpl }).complete({ messages: [{ role: "user", content: "x" }], thinking: "low", json: { name: "v", schema: VERDICT_SCHEMA } });
  assert.equal(a.calls.length, 2);
  assert.deepEqual(a.calls[1].body.output_config, { effort: "low" });
  assert.equal(out.text, "{}");
  const e = fakeFetch((body) => body.output_config?.effort ? bad(400, "output_config.effort: not supported on this model") : text("ok"));
  await createAnthropicProvider({ fetchImpl: e.fetchImpl }).complete({ messages: [{ role: "user", content: "x" }], thinking: "low" });
  assert.equal(e.calls.length, 2);
  assert.equal("output_config" in e.calls[1].body, false);
  const auth = { status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
  await assert.rejects(createAnthropicProvider({ fetchImpl: fakeFetch(auth).fetchImpl }).complete({ messages: [] }), /^Error: Anthropic API 401: invalid x-api-key$/);
  const refusal = ok({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } });
  await assert.rejects(createAnthropicProvider({ fetchImpl: fakeFetch(refusal).fetchImpl }).complete({ messages: [] }), /Claude declined this request \(cyber\)/);
  const spent = ok({ content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens" });
  await assert.rejects(createAnthropicProvider({ fetchImpl: fakeFetch(spent).fetchImpl }).complete({ messages: [], maxTokens: 4000 }), /Claude spent its whole 4000-token budget/);
});

test("mock: scripted answers in order, functions and errors, every call recorded", async () => {
  const mock = createMockProvider();
  mock.script({ a: 1 }, "plain", (req, n) => ({ n, system: req.system }), new Error("down"));
  const r1 = await mock.complete({ system: "S", messages: [{ role: "user", content: "x" }] });
  assert.equal(r1.text, '{"a":1}');
  assert.equal(r1.provider, "mock");
  assert.equal(r1.model, "mock-1");
  assert.equal(r1.usage.total_tokens, r1.usage.prompt_tokens + r1.usage.completion_tokens);
  assert.equal((await mock.complete({})).text, "plain");
  assert.deepEqual(JSON.parse((await mock.complete({ system: "T" })).text), { n: 3, system: "T" });
  await assert.rejects(mock.complete({}), /down/);
  await assert.rejects(mock.complete({}), /no scripted answer for call 5/);
  mock.respondWith(() => "always");
  assert.equal((await mock.complete({})).text, "always");
  assert.equal(mock.calls.length, 6);
  assert.equal(mock.calls[0].system, "S");
  mock.reset();
  assert.equal(mock.calls.length, 0);
  await assert.rejects(mock.complete({}), /no scripted answer/);
});

test("the engine runs on any provider: LLM_PROVIDER=mock judges a message end to end", async () => {
  assert.equal((await checkMessage(plain)).source, "detector (Muse Spark not configured)");
  process.env.LLM_PROVIDER = "mock";
  const mock = getProvider("mock");
  mock.script(VERDICT);
  const v = await checkMessage(plain);
  assert.equal(v.source, "Mock LLM (mock-1)");
  assert.equal(v.verdict, "be_careful");
  assert.ok(v.usage.total_tokens > 0);
  assert.equal(typeof v.latency_ms, "number");
  const req = mock.calls[0];
  assert.match(req.system, /Prudence/);
  assert.equal(req.messages.length, 1);
  assert.match(req.messages[0].content, /<message>/);
  assert.equal(req.json.name, "scam_shield_verdict");
  assert.equal(req.json.schema, VERDICT_SCHEMA);
  assert.equal(req.maxTokens, 4000);
  assert.equal(req.temperature, 0.1);
  assert.equal(req.thinking, undefined, "the mock has no default effort");
  assert.ok(req.signal instanceof AbortSignal);
  // The screenshot path sends a neutral image part.
  mock.script({ is_message: true, channel: "sms", sender_name: null, sender: "+1 555 0199", subject: null, body: "pay", links: [] });
  const img = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.deepEqual(mock.calls[1].messages[0].content[1], { type: "image", mime: "image/png", base64: "aGVsbG8=" });
  assert.equal(mock.calls[1].json.name, "message_transcription");
  assert.equal(img.message.channel, "sms");
  // A failure still falls back to the detector, naming the provider.
  mock.script(new Error("down"));
  const f = await checkMessage(plain);
  assert.equal(f.source, "detector (Mock LLM unavailable)");
  assert.equal(f.degraded, true);
  assert.equal(f.error, "down");
});

test("museChat keeps the engine's tuning: 4000 tokens, temperature 0.1, one deadline per check", async () => {
  process.env.LLM_PROVIDER = "mock";
  const mock = getProvider("mock");
  mock.script("hi", async (req) => { await new Promise((r) => setTimeout(r, 60)); return req.signal.aborted ? "aborted" : "late"; });
  const out = await museChat({ system: "S", messages: [{ role: "user", content: "u" }] });
  assert.equal(out.text, "hi");
  assert.equal(out.provider, "mock");
  assert.equal(typeof out.ms, "number");
  assert.equal(mock.calls[0].maxTokens, 4000);
  assert.equal(mock.calls[0].temperature, 0.1);
  assert.equal(mock.calls[0].json, undefined);
  assert.equal((await museChat({ messages: [], timeoutMs: 10 })).text, "aborted", "the deadline reaches the provider");
  process.env.LLM_THINKING = "high";
  mock.script("x");
  await museChat({ messages: [] });
  assert.equal(mock.calls[2].thinking, "high");
});

// Function calling (Look closer, _product/specs/investigate.md): the wire
// format live-tested on the Meta Model API on 2026-11-04.
const TOOL = { name: "website_age", description: "When a website was registered", strict: true,
  parameters: { type: "object", additionalProperties: false, required: ["domain"], properties: { domain: { type: "string" } } } };
const toolTurn = (calls, content = "I'll check the age of that link's domain.") => ({
  choices: [{ message: { role: "assistant", content, tool_calls: calls }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 625, completion_tokens: 161, total_tokens: 786 } });

test("tools: Meta gets function tools with tool_choice auto, and the model's tool calls come back with their arguments parsed", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const { fetchImpl, calls } = fakeFetch(ok(toolTurn([
    { id: "call_1", type: "function", function: { name: "website_age", arguments: '{"domain":"usps-redelivery-fee.top"}' } },
    { id: "call_2", type: "function", function: { name: "scam_patterns", arguments: "" } },
  ])));
  const out = await createMetaProvider({ fetchImpl }).complete({ system: "S", messages: [{ role: "user", content: "m" }], maxTokens: 2000, temperature: 0.1,
    thinking: "low", tools: [TOOL], json: { name: "look_closer", schema: { type: "object" } } });
  const body = calls[0].body;
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "website_age", description: "When a website was registered", parameters: TOOL.parameters, strict: true } }]);
  assert.equal(body.tool_choice, "auto", "the only choice Meta takes");
  assert.equal(body.response_format.json_schema.name, "look_closer", "tools and the answer's schema travel together");
  assert.equal(body.reasoning_effort, "low");
  assert.deepEqual(out.toolCalls, [{ id: "call_1", name: "website_age", arguments: { domain: "usps-redelivery-fee.top" } }, { id: "call_2", name: "scam_patterns", arguments: {} }]);
  assert.equal(out.text, "I'll check the age of that link's domain.");
  assert.equal(out.usage.prompt_tokens, 625);
  const words = await createMetaProvider({ fetchImpl: fakeFetch(ok(chat("done"))).fetchImpl }).complete({ messages: [], tools: [TOOL] });
  assert.deepEqual(words.toolCalls, [], "an answer in words carries no tool calls");
  const plainCall = fakeFetch(ok(chat("x")));
  assert.equal("toolCalls" in (await createMetaProvider({ fetchImpl: plainCall.fetchImpl }).complete({ messages: [] })), false, "no tools asked, the answer keeps its old shape");
  assert.equal("tools" in plainCall.calls[0].body || "tool_choice" in plainCall.calls[0].body, false, "and the request carries no tools");
});

test("tools: the model's turn and each tool answer go back in OpenAI's shape", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const turn = [{ role: "user", content: "m" },
    { role: "assistant", content: "Checking.", toolCalls: [{ id: "call_1", name: "website_age", arguments: { domain: "a.test" } }] },
    { role: "tool", toolCallId: "call_1", content: '{"check":1}' }];
  const { fetchImpl, calls } = fakeFetch(ok(chat("final")));
  await createMetaProvider({ fetchImpl }).complete({ messages: turn, tools: [TOOL] });
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "m" },
    { role: "assistant", content: "Checking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "website_age", arguments: '{"domain":"a.test"}' } }] },
    { role: "tool", tool_call_id: "call_1", content: '{"check":1}' }]);
  assert.deepEqual(toOpenAiMessages("", [{ role: "assistant", content: "", toolCalls: [{ id: "c", name: "n", arguments: '{"x":1}' }] }, { role: "tool", toolCallId: "c", content: 7 }]),
    [{ role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "n", arguments: '{"x":1}' } }] }, { role: "tool", tool_call_id: "c", content: "7" }],
    "arguments already in text stay as they are; a tool answer is always text");
  assert.deepEqual(toOpenAiMessages("", [{ role: "assistant", content: "hi", toolCalls: [] }]), [{ role: "assistant", content: "hi" }], "no calls, a plain turn");
});

test("tools: a call whose arguments are not a JSON object is marked invalid on its own, the other calls stand", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const broken = fakeFetch(ok(toolTurn([{ id: "c1", type: "function", function: { name: "website_age", arguments: '{"domain": "a.te' } },
    { id: "c2", type: "function", function: { name: "website_age", arguments: '{"domain":"b.test"}' } }])));
  const out = await createMetaProvider({ fetchImpl: broken.fetchImpl }).complete({ messages: [], tools: [TOOL] });
  assert.deepEqual(out.toolCalls, [{ id: "c1", name: "website_age", arguments: {}, invalid: "arguments that are not JSON" },
    { id: "c2", name: "website_age", arguments: { domain: "b.test" } }]);
  for (const raw of ["null", "[1]", "42"]) {
    assert.deepEqual(parseToolCalls([{ id: "c", function: { name: "x", arguments: raw } }]), [{ id: "c", name: "x", arguments: {}, invalid: "arguments that are not an object" }], raw);
  }
  assert.deepEqual(parseToolCalls([{ id: "c", function: { name: "x", arguments: { a: 1 } } }]), [{ id: "c", name: "x", arguments: { a: 1 } }], "an object stays an object");
  assert.deepEqual(parseToolCalls(undefined), []);
});

test("an answer that is not a chat completion (a 200 with an HTML page, an empty body, no choices) fails plainly instead of reading as an empty answer", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const page = async () => new Response("<html>Gateway</html>", { status: 200 });
  await assert.rejects(createMetaProvider({ fetchImpl: page }).complete({ messages: [], tools: [TOOL] }), /^Error: Meta Model API answered with something that is not a chat completion$/);
  await assert.rejects(createMetaProvider({ fetchImpl: fakeFetch(ok({})).fetchImpl }).complete({ messages: [] }), /not a chat completion/);
  await assert.rejects(createMetaProvider({ fetchImpl: fakeFetch(ok({ choices: [] })).fetchImpl }).complete({ messages: [] }), /not a chat completion/);
  process.env.OPENAI_API_KEY = "sk";
  await assert.rejects(createOpenAiCompatibleProvider({ preset: "groq", fetchImpl: page }).complete({ messages: [] }), /^Error: Groq API answered with something that is not a chat completion$/);
});

test("tools: every OpenAI-style preset sends them too; a spent budget with tool calls is still an answer", async () => {
  process.env.OPENAI_API_KEY = "sk";
  const { fetchImpl, calls } = fakeFetch(ok({ choices: [{ message: { content: null, tool_calls: [{ id: "g1", type: "function", function: { name: "website_age", arguments: '{"domain":"b.test"}' } }] }, finish_reason: "length" }] }));
  const out = await createOpenAiCompatibleProvider({ preset: "groq", fetchImpl }).complete({ messages: [{ role: "user", content: "x" }], tools: [{ ...TOOL, strict: undefined }], maxTokens: 50 });
  assert.equal(calls[0].body.tool_choice, "auto");
  assert.equal("strict" in calls[0].body.tools[0].function, false, "strict only when the tool says so");
  assert.deepEqual(out.toolCalls, [{ id: "g1", name: "website_age", arguments: { domain: "b.test" } }]);
  assert.equal(out.text, "");
  assert.equal(capabilities().groq.tools, true);
  assert.equal(capabilities().meta.tools, true);
});

test("tools: Claude refuses them before any request leaves", async () => {
  process.env.ANTHROPIC_API_KEY = "a";
  const { fetchImpl, calls } = fakeFetch(ok({ content: [{ type: "text", text: "x" }] }));
  const claude = createAnthropicProvider({ fetchImpl });
  await assert.rejects(claude.complete({ messages: [{ role: "user", content: "m" }], tools: [TOOL] }), /^Error: tools are not supported by this provider \(Claude\)$/);
  await assert.rejects(claude.complete({ messages: [{ role: "tool", toolCallId: "c", content: "{}" }] }), /tools are not supported/);
  assert.equal(calls.length, 0);
  assert.equal((await claude.complete({ messages: [{ role: "user", content: "m" }], tools: [] })).text, "x", "an empty list is no tools");
  assert.equal(capabilities().anthropic.tools, false);
});

test("tools: the mock scripts tool calls, records the tools offered, and says which providers can use them", async () => {
  const mock = createMockProvider();
  mock.script({ toolCalls: [{ name: "website_age", arguments: { domain: "a.test" } }, { id: "mine", name: "scam_patterns" }], content: "Let me check." }, { verdict: "scam" });
  const first = await mock.complete({ messages: [{ role: "user", content: "m" }], tools: [TOOL] });
  assert.deepEqual(first.toolCalls, [{ id: "call_mock_1_1", name: "website_age", arguments: { domain: "a.test" } }, { id: "mine", name: "scam_patterns", arguments: {} }]);
  assert.equal(first.text, "Let me check.");
  assert.deepEqual(mock.calls[0].tools, [TOOL]);
  const second = await mock.complete({ messages: [], tools: [TOOL] });
  assert.deepEqual(second.toolCalls, [], "words, with tools offered");
  assert.equal(second.text, '{"verdict":"scam"}');
  mock.script("plain");
  assert.equal("toolCalls" in (await mock.complete({ messages: [] })), false, "no tools offered, the old shape");
  assert.equal(toolsConfigured(), false, "Muse Spark without its key: no tools");
  process.env.META_MODEL_API_KEY = "k";
  assert.equal(toolsConfigured(), true);
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "a";
  assert.equal(toolsConfigured(), false, "Claude is configured but cannot call tools here");
  process.env.LLM_PROVIDER = "mock";
  assert.equal(toolsConfigured(), true);
  process.env.LLM_PROVIDER = "nope";
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(toolsConfigured(), false); } finally { console.warn = warn; }
});
