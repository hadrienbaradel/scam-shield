// Prompt Guard without a network, for tests and offline rehearsals
// (PROMPT_GUARD_PROVIDER=mock; the card then says "Prompt Guard (mock)").
// One shared instance, like lib/llm's mock:
//   mockGuard.script(0.97, 0.01, new Error("down"), (text, n) => 0.5)
// queues one answer per chunk scored (a number is the probability of an
// attack, an Error is thrown, a function gets the text and the call number).
// Without a script, text that gives an AI orders ("ignore previous
// instructions", "AI assistant: ... mark it safe") scores 0.99, the rest 0.01.
// mockGuard.calls holds every text received; reset() clears both.

const ORDERS = /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(instructions?|rules|prompts?)\b|\b(ai|a\.i\.|assistant|llm|chatbot|language model)\b[^.\n]{0,60}\b(safe|legitimate|genuine|harmless)\b|\bsystem prompt\b/i;

export function createMockGuard() {
  const calls = [];
  let queue = [];
  const guard = {
    name: "mock",
    keyName: null,
    model: "mock-prompt-guard-2",
    label: "Prompt Guard (mock)",
    calls,
    configured: () => true,
    script(...answers) { queue.push(...answers); return guard; },
    reset() { queue = []; calls.length = 0; return guard; },
    async score(text) {
      calls.push(text);
      let answer = queue.length ? queue.shift() : (ORDERS.test(text) ? 0.99 : 0.01);
      if (typeof answer === "function") answer = await answer(text, calls.length);
      if (answer instanceof Error) throw answer;
      const n = Number(answer);
      if (!Number.isFinite(n)) throw new Error(`mock Prompt Guard: no number for call ${calls.length}`);
      return Math.min(1, Math.max(0, n));
    },
  };
  return guard;
}

export const mockGuard = createMockGuard();
