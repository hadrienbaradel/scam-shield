// The ad studio's engine (_product/specs/ad-studio.md lines 2 to 5, plan
// contract C2): Muse Spark writes ad ideas from the fact sheet, the words are
// refused in code when they say more than it (./guardrails.js), Muse Image
// makes each photo, Muse Spark looks at the photo and asks for at most one
// fix, and an admin's instruction edits words and photo. Nothing here
// publishes or stores: the console (src/routes/ads.js) does, after a person
// approves. The words and the photo show the same people: validateWords
// refuses a plain contradiction ("Dad" over a photo brief of a mother), the
// photo check reads the ad's words beside the photo brief, and an edit that
// changes who the words name re-checks the current photo.
//
//   proposeIdeas({ brief, count = 3, signal })             -> { ideas: [words], dropped: [{ reason }], model }
//   makePhoto({ words, signal })                           -> { photo, check, models: { image, check }, photosMade }
//   editIdea({ words, photo, check, instruction, signal }) -> { words, photo, check, changed: { words, photo, fields }, models, photosMade }
//   checkPhoto({ photo, words, signal })                   -> check
//   words: { headline, primary_text, description, cta, photo_brief, landing: { headline, lead } }
//   check: { pass, problems: [string], fixed: [string], summary, model }
//
// Every model call goes through lib/llm (complete with a JSON schema and
// thinking "low"; generateImage / editImage), 60 s for words and checks, 90 s
// for a photo, inside the caller's signal. The admin's brief and instruction
// are data in an escaped tag, never system instructions (as lib/libraryMuse.js
// sends an example). A failed photo check never loses the photo: the card
// then says it was not checked. editIdea keeps the photo and the check it was
// given when only the words change (changed.photo false).

import { complete, editImage, generateImage, imageLabel, llmLabel } from "../llm/index.js";
import { titleOf } from "../llm/images.js";
import { adPrompts, factsForModel, LIMITS, normalizeWords, parentsNamed, validateWords } from "./guardrails.js";

// validateWords(words) -> { ok, problems }: line 3 in code (./guardrails.js), part of C2.
export { validateWords };

export const PHOTO_COST_USD = 0.01;
export const PHOTO_SIZE = "1080x1350";
export const TEXT_TIMEOUT_MS = 60_000;
// A photo check that got no answer is asked once more, with its own limit (Muse Spark
// stalled for minutes on Nov 4; the same photos checked minutes later in 7 to 9 s).
export const CHECK_RETRY_TIMEOUT_MS = 45_000;
export const IMAGE_TIMEOUT_MS = 90_000;
export const MAX_IDEAS = 4;

const text = (max) => ({ type: "string", maxLength: max });
export const WORDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "primary_text", "description", "cta", "photo_brief", "landing"],
  properties: {
    headline: text(LIMITS.headline),
    primary_text: text(LIMITS.primary_text),
    description: text(LIMITS.description),
    cta: { type: "string", enum: ["LEARN_MORE", "SIGN_UP"] },
    photo_brief: text(LIMITS.photo_brief),
    landing: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "lead"],
      properties: { headline: text(LIMITS["landing.headline"]), lead: text(LIMITS["landing.lead"]) },
    },
  },
};
export const IDEAS_SCHEMA = { type: "object", additionalProperties: false, required: ["ideas"], properties: { ideas: { type: "array", items: WORDS_SCHEMA } } };
export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "problems", "fix"],
  properties: { pass: { type: "boolean" }, problems: { type: "array", items: { type: "string" } }, fix: { type: ["string", "null"] } },
};
export const EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["words", "photo_instruction"],
  properties: { words: WORDS_SCHEMA, photo_instruction: { type: ["string", "null"] } },
};

// ------------------------------------------------------------ helpers ---
const within = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
// Data in a tag: JSON with < and > escaped, so it can never close the tag and pose as instructions.
const block = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
const imagePart = (photo) => ({ type: "image", mime: photo.mime || "image/jpeg", base64: Buffer.from(photo.bytes).toString("base64") });
const systemFor = (task) => {
  const p = adPrompts();
  return [p[task], `## Fact sheet (the only claims you may make)\n${factsForModel()}`, `## Audience and tone\n${p["Audience and tone"]}`, `## Rules for the words\n${p["Rules for the words"]}`].join("\n\n");
};
const listed = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

// "Muse Spark 1.3" for muse-spark-1.3 on Meta; "Claude (claude-opus-5-5)" elsewhere.
export function modelLabel(id) {
  const label = llmLabel();
  const title = titleOf(String(id || ""));
  return title !== id && title.toLowerCase().startsWith(label.toLowerCase()) ? title : `${label}${id ? ` (${id})` : ""}`;
}

function parseJson(raw) {
  const s = String(raw || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object");
  return JSON.parse(s.slice(start, end + 1));
}

// One model call for JSON: a timeout or a non-JSON answer becomes one plain sentence.
async function ask({ system, messages, schema, name, maxTokens, temperature, signal, timeoutMs = TEXT_TIMEOUT_MS }) {
  let out;
  try {
    out = await complete({
      system, messages, maxTokens, temperature, json: { name, schema }, thinking: "low", signal: within(signal, timeoutMs),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e?.name === "TimeoutError") throw Object.assign(new Error(`${llmLabel()} did not answer within ${timeoutMs / 1000} seconds`), { code: "timeout" });
    throw e;
  }
  try {
    return { data: parseJson(out.text), text: out.text, model: modelLabel(out.model) };
  } catch {
    throw Object.assign(new Error(`${llmLabel()} answered with something that is not JSON`), { code: "not_json" });
  }
}

// No answer worth trying again: a timeout, the network, a 5xx, an answer that is not JSON.
// A 4xx or a refusal would say the same thing twice.
export function noAnswer(e) {
  if (e?.code === "timeout" || e?.code === "not_json" || e?.name === "TimeoutError") return true;
  if (e?.status >= 500 || /\b5\d\d\b/.test(String(e?.message || "").split(":")[0])) return true;
  return e?.name === "TypeError" || /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(String(e?.message || "") + String(e?.cause?.code || ""));
}

// ------------------------------------------------------------- ideas ---
export async function proposeIdeas({ brief = "", count = 3, signal } = {}) {
  const n = Math.min(MAX_IDEAS, Math.max(1, Math.round(Number(count)) || 3));
  const wish = String(brief || "").trim().slice(0, 1000);
  const content = `Write ${n} idea${n > 1 ? "s" : ""}.\n${wish ? `<brief>${block(wish)}</brief>` : "No brief: choose the angles yourself."}`;
  const first = await ask({
    system: systemFor("Ideas"), messages: [{ role: "user", content }], schema: IDEAS_SCHEMA, name: "ad_ideas",
    maxTokens: 8000, temperature: 0.8, signal,
  });
  const drafts = (Array.isArray(first.data?.ideas) ? first.data.ideas : []).slice(0, n);
  if (!drafts.length) throw new Error(`${llmLabel()} wrote no ideas`);
  // A refused idea is written again once with its problems; refused twice, it is dropped with the reason.
  const results = await Promise.all(drafts.map(async (draft) => {
    const words = normalizeWords(draft);
    const verdict = validateWords(words);
    if (verdict.ok) return { words };
    let again;
    try {
      again = await ask({
        system: systemFor("Rewrite"), schema: WORDS_SCHEMA, name: "ad_idea", maxTokens: 4000, temperature: 0.5, signal,
        messages: [{ role: "user", content: `<idea>${block(words)}</idea>\n<problems>${block(verdict.problems)}</problems>` }],
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      return { dropped: { reason: `Refused (${verdict.problems.join("; ")}), and the rewrite failed: ${e.message}` } };
    }
    const fixed = normalizeWords(again.data);
    const second = validateWords(fixed);
    return second.ok ? { words: fixed } : { dropped: { reason: `Refused twice: ${second.problems.join("; ")}` } };
  }));
  return {
    ideas: results.filter((r) => r.words).map((r) => r.words),
    dropped: results.filter((r) => r.dropped).map((r) => r.dropped),
    model: first.model,
  };
}

// ------------------------------------------------------------- photos ---
// The words the photo stands beside on Facebook and on the landing page.
const shownWith = (words) => ({ headline: String(words?.headline || ""), primary_text: String(words?.primary_text || ""), landing_headline: String(words?.landing?.headline || "") });

// What Muse Spark sees: the checklist (system), the photo brief and the ad's words as data, the photo.
// When Muse Spark does not answer, once more with a fresh limit; never after the caller's abort.
async function look({ photo, words, signal }) {
  const request = {
    system: adPrompts()["Photo check"], schema: CHECK_SCHEMA, name: "photo_check", maxTokens: 4000, temperature: 0.1, signal,
    messages: [{ role: "user", content: [
      { type: "text", text: `<photo_brief>${block(String(words?.photo_brief || ""))}</photo_brief>\n<words>${block(shownWith(words))}</words>\nCheck this photo against the checklist.` },
      imagePart(photo),
    ] }],
  };
  let answer;
  try { answer = await ask(request); } catch (e) {
    if (signal?.aborted || !noAnswer(e)) throw e;
    answer = await ask({ ...request, timeoutMs: CHECK_RETRY_TIMEOUT_MS });
  }
  const { data, model } = answer;
  const problems = (Array.isArray(data?.problems) ? data.problems : [])
    .map((p) => String(p ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 120)).filter(Boolean).slice(0, 5);
  const pass = data?.pass === true && problems.length === 0;
  if (!pass && !problems.length) problems.push(`something ${llmLabel()} did not name`);
  const fix = !pass && typeof data?.fix === "string" && data.fix.trim() ? data.fix.trim().slice(0, 500) : null;
  return { pass, problems, fix, model };
}

function toCheck({ pass, problems, model }, fixed = []) {
  const who = llmLabel();
  const summary = pass
    ? (fixed.length ? `Checked by ${who}: fixed ${listed(fixed)}` : `Checked by ${who}: no problem found`)
    : `${problems.length} problem${problems.length > 1 ? "s" : ""} left: ${problems.join("; ")}`;
  return { pass, problems: pass ? [] : problems, fixed, summary: summary.slice(0, 240), model };
}

// A check that could not run keeps the photo: the card says so, and a person still decides.
function notChecked(e) {
  return { pass: false, problems: [`not checked: ${e.message}`], fixed: [], summary: `Not checked: ${llmLabel()} did not answer`, model: llmLabel() };
}

export async function checkPhoto({ photo, words, signal } = {}) {
  if (!photo?.bytes) throw new Error("There is no photo to check");
  return toCheck(await look({ photo, words, signal }));
}

// Check, at most one fix by an edit, check again.
async function checkAndFix({ photo, words, signal, made }) {
  let first;
  try { first = await look({ photo, words, signal }); } catch (e) {
    if (signal?.aborted) throw e;
    return { photo, check: notChecked(e) };
  }
  if (first.pass || !first.fix) return { photo, check: toCheck(first) };
  let edited;
  try {
    const out = await editImage({
      prompt: `${first.fix} ${adPrompts()["Photo edit"]}`, images: [photo], size: PHOTO_SIZE, format: "jpeg", signal: within(signal, IMAGE_TIMEOUT_MS),
    });
    made.count += out.images.length;
    edited = out.images[0];
  } catch (e) {
    if (signal?.aborted) throw e;
    const check = toCheck(first);
    return { photo, check: { ...check, summary: `${check.summary} (the fix failed: ${e.message})`.slice(0, 240) } };
  }
  let second;
  try { second = await look({ photo: edited, words, signal }); } catch (e) {
    if (signal?.aborted) throw e;
    return { photo: edited, check: notChecked(e) };
  }
  return { photo: edited, check: toCheck(second, second.pass ? first.problems : []) };
}

export const photoPrompt = (brief) => `${String(brief).trim()}\n\n${adPrompts().Photo}`;

export async function makePhoto({ words, signal } = {}) {
  const brief = String(words?.photo_brief || "").trim();
  if (!brief) throw new Error("This idea has no photo brief");
  const made = { count: 0 };
  const out = await generateImage({ prompt: photoPrompt(brief), size: PHOTO_SIZE, n: 1, format: "jpeg", signal: within(signal, IMAGE_TIMEOUT_MS) });
  made.count += out.images.length;
  const result = await checkAndFix({ photo: out.images[0], words, signal, made });
  return { photo: result.photo, check: result.check, models: { image: out.label, check: result.check.model }, photosMade: made.count };
}

// -------------------------------------------------------------- edits ---
const FIELDS = ["headline", "primary_text", "description", "cta", "photo_brief", "landing.headline", "landing.lead"];
const valueAt = (w, path) => path.split(".").reduce((v, k) => v?.[k], w);

export async function editIdea({ words, photo, check = null, instruction, signal } = {}) {
  const asked = String(instruction || "").trim().slice(0, 1000);
  if (!asked) throw new Error("Type what to change.");
  const current = normalizeWords(words);
  const content = [
    { type: "text", text: `<instruction>${block(asked)}</instruction>\n<words>${block(current)}</words>${photo?.bytes ? "\nThe current photo follows." : "\nThere is no photo yet."}` },
    ...(photo?.bytes ? [imagePart(photo)] : []),
  ];
  const messages = [{ role: "user", content }];
  const call = () => ask({ system: systemFor("Edit"), messages, schema: EDIT_SCHEMA, name: "ad_edit", maxTokens: 6000, temperature: 0.4, signal });
  let answer = await call();
  let next = normalizeWords(answer.data?.words);
  let verdict = validateWords(next);
  if (!verdict.ok) {
    messages.push({ role: "assistant", content: answer.text }, { role: "user", content: `These words were refused: <problems>${block(verdict.problems)}</problems>\nAnswer again with the full words, without these problems.` });
    answer = await call();
    next = normalizeWords(answer.data?.words);
    verdict = validateWords(next);
    if (!verdict.ok) throw new Error(`The new words were refused twice: ${verdict.problems.join("; ")}`);
  }
  const photoInstruction = typeof answer.data?.photo_instruction === "string" && answer.data.photo_instruction.trim()
    ? answer.data.photo_instruction.trim().slice(0, 500) : null;
  const fields = FIELDS.filter((f) => valueAt(current, f) !== valueAt(next, f));
  const result = {
    words: next, photo: photo ?? null, check, changed: { words: fields.length > 0, photo: false, fields },
    models: { words: answer.model, image: null, check: null }, photosMade: 0,
  };
  if (!photoInstruction) {
    // The words now name someone else and the photo was not asked to change: the same
    // photo check (the people match the words), with its one fix, on the current photo.
    const was = parentsNamed(current);
    const now = parentsNamed(next);
    if (!photo?.bytes || (was.words === now.words && was.photo === now.photo)) return result;
    const made = { count: 0 };
    const checked = await checkAndFix({ photo, words: next, signal, made });
    const fixed = checked.photo !== photo;
    return {
      ...result, photo: checked.photo, check: checked.check, changed: { ...result.changed, photo: fixed },
      models: { words: answer.model, image: fixed ? imageLabel() : null, check: checked.check.model }, photosMade: made.count,
    };
  }
  const made = { count: 0 };
  // The photo changes by an edit of the current one; with no photo yet, a new one from the brief.
  const out = photo?.bytes
    ? await editImage({ prompt: `${photoInstruction} ${adPrompts()["Photo edit"]}`, images: [photo], size: PHOTO_SIZE, format: "jpeg", signal: within(signal, IMAGE_TIMEOUT_MS) })
    : await generateImage({ prompt: photoPrompt(next.photo_brief), size: PHOTO_SIZE, n: 1, format: "jpeg", signal: within(signal, IMAGE_TIMEOUT_MS) });
  made.count += out.images.length;
  const checked = await checkAndFix({ photo: out.images[0], words: next, signal, made });
  return {
    ...result, photo: checked.photo, check: checked.check, changed: { ...result.changed, photo: true },
    models: { words: answer.model, image: out.label, check: checked.check.model }, photosMade: made.count,
  };
}
