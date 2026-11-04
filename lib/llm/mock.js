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
// Photos (IMAGE_PROVIDER=mock) have their own queue: `mock.scriptImage(buf,
// new Error("down"), (req, n) => buf)` answers generateImage and editImage
// in order (a Buffer, a { bytes, mime }, an Error, or a function returning
// one); unscripted, every call gets TINY_JPEG (a valid 4x5 JPEG).
// `mock.imageCalls[i]` holds each request ({ kind: "generate" | "edit",
// prompt, images, size, n, format, signal }).

const tokens = (s) => Math.ceil(String(s || "").length / 4);
// A 4x5 baseline JPEG of 678 bytes (the ad photo's ratio), decodable by any viewer.
export const TINY_JPEG = Buffer.from("/9j/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgABQAEAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcHCwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLv/dAAQAAf/aAAwDAQACEQMRAD8A+iaKKK4ToP/Z", "base64");
const isToolAnswer = (a) => Boolean(a) && typeof a === "object" && !Array.isArray(a) && Array.isArray(a.toolCalls);

export function createMockProvider({ model = "mock-1" } = {}) {
  const calls = [];
  const transcribeCalls = [];
  const imageCalls = [];
  let queue = [];
  let transcripts = [];
  let photos = [];
  let fallback = null;
  const provider = {
    name: "mock",
    label: "Mock LLM",
    capabilities: { json: "schema", thinking: "effort", temperature: true, images: true, transcribe: true, tools: true },
    calls,
    transcribeCalls,
    imageCalls,
    script(...answers) { queue.push(...answers); return provider; },
    scriptTranscript(...answers) { transcripts.push(...answers); return provider; },
    scriptImage(...answers) { photos.push(...answers); return provider; },
    respondWith(fn) { fallback = fn; return provider; },
    reset() { queue = []; transcripts = []; photos = []; calls.length = 0; transcribeCalls.length = 0; imageCalls.length = 0; fallback = null; return provider; },
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

    // Photos: the image side of the layer (lib/llm/images.js has the real adapters).
    imageConfigured: () => true,
    imageModel: () => process.env.IMAGE_MODEL || "mock-image-1",
    imageLabel: () => "Mock Image",
    generateImage: (request = {}) => photo("generate", request),
    editImage: (request = {}) => photo("edit", request),

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
  async function photo(kind, request) {
    const { prompt, images = [], size, n = 1, format = "jpeg", signal } = request;
    imageCalls.push({ kind, prompt, images, size, n, format, signal });
    let answer = photos.length ? photos.shift() : TINY_JPEG;
    if (typeof answer === "function") answer = await answer(request, imageCalls.length);
    if (answer instanceof Error) throw answer;
    const one = Buffer.isBuffer(answer) ? { bytes: answer, mime: "image/jpeg" } : answer;
    if (!one?.bytes) throw new Error(`mock image: no photo for call ${imageCalls.length}`);
    return { images: Array.from({ length: Math.max(1, n) }, () => ({ bytes: one.bytes, mime: one.mime || "image/jpeg" })), model: provider.imageModel(), provider: "mock", label: provider.imageLabel() };
  }
  return provider;
}
