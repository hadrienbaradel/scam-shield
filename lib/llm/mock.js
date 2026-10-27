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

const tokens = (s) => Math.ceil(String(s || "").length / 4);

export function createMockProvider({ model = "mock-1" } = {}) {
  const calls = [];
  let queue = [];
  let fallback = null;
  const provider = {
    name: "mock",
    label: "Mock LLM",
    capabilities: { json: "schema", thinking: "effort", temperature: true, images: true },
    calls,
    script(...answers) { queue.push(...answers); return provider; },
    respondWith(fn) { fallback = fn; return provider; },
    reset() { queue = []; calls.length = 0; fallback = null; return provider; },
    configured: () => true,
    model: () => process.env.LLM_MODEL || model,
    defaultThinking: () => undefined,

    async complete(request = {}) {
      calls.push(request);
      let answer = queue.length ? queue.shift() : fallback;
      if (typeof answer === "function") answer = await answer(request, calls.length);
      if (answer instanceof Error) throw answer;
      if (answer === undefined || answer === null) throw new Error(`mock LLM: no scripted answer for call ${calls.length}`);
      const text = typeof answer === "string" ? answer : JSON.stringify(answer);
      const prompt_tokens = tokens(request.system) + tokens(JSON.stringify(request.messages || []));
      const completion_tokens = tokens(text);
      return {
        text,
        usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
        model: provider.model(),
        provider: "mock",
        raw: { scripted: answer },
      };
    },
  };
  return provider;
}
