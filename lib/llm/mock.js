// Deterministic provider for tests: scripted answers, no network, every
// request recorded. Select it with LLM_PROVIDER=mock or build your own with
// createMockProvider(); `getProvider("mock")` always returns one shared
// instance, so a test can script it and the engine under test will use it.
//   const mock = getProvider("mock");
//   mock.script({ verdict: "safe", ... }, "plain text", new Error("down"), (req) => ({...}));
//   ... run the code under test ...
//   mock.calls[0].system, mock.calls[0].messages, mock.calls[0].json
// An object answer is sent as JSON text; a function gets (request, callNo)
// and returns any of those; an Error is thrown. `respondWith(fn)` answers
// every call the script does not cover; `reset()` clears everything.
// Speech to text has its own queue: `mock.scriptTranscript("Grandma, it's
// me…", new Error("down"), (req, n) => "…")` (a string is the transcript),
// and `mock.transcribeCalls[i]` holds each request ({ wav, language, signal }).
// The mock counts as able to transcribe only while something is scripted, so
// a test that never scripts a transcript sees what the product does without
// Meta's key: no voice checks.
// Function calling: an object with a toolCalls array is the model asking
// for tools, `mock.script({ toolCalls: [{ name: "website_age", arguments:
// { domain: "x.test" } }], content: "Let me check." })`: the answer carries
// toolCalls (ids made up when absent, arguments as given) and the words in
// text; `mock.calls[i].tools` and `.messages` record what was offered and
// echoed back. A request with tools always gets toolCalls ([] for words).

const tokens = (s) => Math.ceil(String(s || "").length / 4);
const isToolAnswer = (a) => Boolean(a) && typeof a === "object" && !Array.isArray(a) && Array.isArray(a.toolCalls);

export function createMockProvider({ model = "mock-1" } = {}) {
  const calls = [];
  const transcribeCalls = [];
  let queue = [];
  let transcripts = [];
  let fallback = null;
  const provider = {
    name: "mock",
    label: "Mock LLM",
    capabilities: { json: "schema", thinking: "effort", temperature: true, images: true, transcribe: true, tools: true },
    calls,
    transcribeCalls,
    script(...answers) { queue.push(...answers); return provider; },
    scriptTranscript(...answers) { transcripts.push(...answers); return provider; },
    respondWith(fn) { fallback = fn; return provider; },
    reset() { queue = []; transcripts = []; calls.length = 0; transcribeCalls.length = 0; fallback = null; return provider; },
    configured: () => true,
    transcribeConfigured: () => transcripts.length > 0,
    model: () => process.env.LLM_MODEL || model,
    defaultThinking: () => undefined,

    async transcribe(request = {}) {
      transcribeCalls.push(request);
      let answer = transcripts.shift();
      if (typeof answer === "function") answer = await answer(request, transcribeCalls.length);
      if (answer instanceof Error) throw answer;
      if (answer === undefined || answer === null) throw new Error(`mock LLM: no scripted transcript for call ${transcribeCalls.length}`);
      return { text: String(answer), model: "mock-transcribe-1", provider: "mock", raw: { scripted: answer } };
    },

    async complete(request = {}) {
      // A copy of the messages: a caller that keeps adding to its array (a tool loop) leaves this turn as it was.
      calls.push(Array.isArray(request.messages) ? { ...request, messages: [...request.messages] } : request);
      let answer = queue.length ? queue.shift() : fallback;
      if (typeof answer === "function") answer = await answer(request, calls.length);
      if (answer instanceof Error) throw answer;
      if (answer === undefined || answer === null) throw new Error(`mock LLM: no scripted answer for call ${calls.length}`);
      const asked = isToolAnswer(answer);
      const text = asked ? String(answer.content || "") : typeof answer === "string" ? answer : JSON.stringify(answer);
      const toolCalls = asked
        ? answer.toolCalls.map((c, i) => ({ id: String(c.id || `call_mock_${calls.length}_${i + 1}`), name: c.name, arguments: c.arguments ?? {}, ...(c.invalid ? { invalid: c.invalid } : {}) }))
        : [];
      const prompt_tokens = tokens(request.system) + tokens(JSON.stringify(request.messages || []));
      const completion_tokens = tokens(text) + tokens(JSON.stringify(toolCalls));
      return {
        text,
        ...(asked || request.tools?.length ? { toolCalls } : {}),
        usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
        model: provider.model(),
        provider: "mock",
        raw: { scripted: answer },
      };
    },
  };
  return provider;
}
