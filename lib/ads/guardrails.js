// The ad studio's rules for words, in code (_product/specs/ad-studio.md line
// 3): an idea is refused when it says something the fact sheet does not, so
// the model is never the only judge of what goes out under Prudence's name.
// validateWords(words) -> { ok, problems: [plain sentences] }:
//   - a number (digits, a percentage) that no Fact sheet line holds outside
//     its [source: ...] brackets; spelled-out numbers ("one tap") pass;
//   - a brand of lib/brands.js BRANDS, whole words, accents folded. Case
//     matters only for names that are also ordinary words (exactName in
//     BRANDS, COMMON_WORD_BRANDS below) and short all-capital acronyms, so
//     "ups and downs", "an apple" and "chase" pass while "UPS", "Apple" and
//     "Chase" do not. ALLOWED_BRANDS lists the ones the fact sheet itself
//     names (Google: Gmail and Google sign-in); Meta and Muse Spark are not in
//     BRANDS, Facebook stays refused (the fact sheet does not name it);
//   - a quote attributed to a person (a name or a dash after it, "says"
//     around it, or "I", "my", "we" inside it);
//   - "guarantee", a price (a currency sign or word, "per month", "free
//     trial"), a fear or urgency line, words that shame older people;
//   - words and photo brief about different parents (parentsNamed: "Dad"
//     in the words, a mother in the brief), only when both say it plainly;
//   - length caps (headline 40, primary_text 125, description 30,
//     landing.headline 60, landing.lead 220, photo_brief 800), the button
//     (LEARN_MORE or SIGN_UP), every field filled.
// The prompts and the fact sheet live in prompts/ad-studio.md, read by heading.

import { readFileSync } from "node:fs";
import { BRANDS, foldAccents } from "../brands.js";

export const LIMITS = { headline: 40, primary_text: 125, description: 30, "landing.headline": 60, "landing.lead": 220, photo_brief: 800 };
export const CTAS = ["LEARN_MORE", "SIGN_UP"];
export const ALLOWED_BRANDS = ["Google"];
const COMMON_WORD_BRANDS = ["Chase", "Apple", "Orange", "Steam", "Ledger", "Exodus", "Allegro", "Discord", "Citi", "Etsy"];
const FIELD_NAMES = {
  headline: "the headline", primary_text: "the main text", description: "the description", photo_brief: "the photo brief",
  "landing.headline": "the landing headline", "landing.lead": "the landing opening line",
};
const PUBLIC_FIELDS = ["headline", "primary_text", "description", "landing.headline", "landing.lead"];

// ------------------------------------------------------------ prompts ---
const PROMPT_FILE = new URL("../../prompts/ad-studio.md", import.meta.url);
let sections = null;
// { "Fact sheet": "...", "Ideas": "...", ... }: each `## ` heading of prompts/ad-studio.md and its text.
export function adPrompts() {
  if (sections) return sections;
  const out = {};
  let name = null;
  for (const line of readFileSync(PROMPT_FILE, "utf8").split(/\r?\n/)) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) { name = h[1]; out[name] = []; } else if (name) out[name].push(line);
  }
  sections = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n").trim()]));
  for (const need of ["Fact sheet", "Audience and tone", "Rules for the words", "Ideas", "Rewrite", "Photo", "Photo edit", "Photo check", "Edit"]) {
    if (!sections[need]) throw new Error(`prompts/ad-studio.md has no "## ${need}" section`);
  }
  return sections;
}
// The facts as the model reads them: the [source: ...] brackets taken out.
export const factsForModel = () => adPrompts()["Fact sheet"].replace(/\s*\[source:[^\]]*\]/gi, "");

// ------------------------------------------------------------ numbers ---
const NUMBER = /\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?:%|percent\b|per cent\b))?/gi;
export const numbersIn = (text = "") => (String(text).match(NUMBER) || [])
  .map((n) => n.replace(/,/g, "").replace(/\s?(?:percent|per cent)$/i, "%").replace(/\s/g, ""));
let allowedNumbers = null;
export function factNumbers() {
  if (!allowedNumbers) allowedNumbers = new Set(numbersIn(factsForModel()));
  return allowedNumbers;
}

// ------------------------------------------------------------- brands ---
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let brandMatchers = null;
function brandsTerms() {
  if (brandMatchers) return brandMatchers;
  brandMatchers = [];
  for (const b of BRANDS) {
    if (ALLOWED_BRANDS.includes(b.name)) continue;
    for (const term of [b.name, ...(b.aliases || [])]) {
      const folded = foldAccents(term);
      const exact = Boolean(b.exactName) || COMMON_WORD_BRANDS.includes(b.name) || /^[A-Z&*]{2,5}$/.test(term);
      brandMatchers.push({ brand: b.name, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(folded)}(?![\\p{L}\\p{N}])`, exact ? "u" : "iu") });
    }
  }
  return brandMatchers;
}
export function brandsIn(text = "") {
  const folded = foldAccents(String(text));
  return [...new Set(brandsTerms().filter((m) => m.re.test(folded)).map((m) => m.brand))];
}

// ------------------------------------------------------------- quotes ---
const QUOTED = /[“"«„]\s*([^“”"«»„]+?)\s*[”"»“]/g;
const SAYS = "(?:says|said|writes|wrote|tells|told|explains|explained|recalls|shares|shared|adds|added)";
const AFTER = new RegExp(`^\\s*[,.]?\\s*(?:[—–~-]\\s*\\p{Lu}|${SAYS}\\b|\\p{Lu}[\\p{L}'.]*(?:\\s+\\p{Lu}[\\p{L}'.]*)?,?\\s+${SAYS}\\b)`, "u");
const BEFORE = new RegExp(`(?:\\b${SAYS}(?:\\s+(?:me|us|her|him|them))?\\s*[:,]?|\\p{Lu}[\\p{L}'.]*\\s*:)\\s*$`, "u");
const FIRST_PERSON = /\b(?:I|I'm|I've|I'd|I'll|me|my|we|we're|our)\b/i;
// Quotes, apostrophes, spaces and case set aside, with the closing punctuation.
const plainQuote = (s) => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”«»„]/g, "\"").replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/, "");
// Words the fact sheet itself says (the trusted person's answers "Scam, Real or I'll call you").
export const inFactSheet = (phrase) => {
  const p = plainQuote(phrase);
  return p.length > 0 && plainQuote(factsForModel()).includes(p);
};
// A speaker in lower case right beside the quote: a possessive and a noun ("my grandson",
// "— my daughter"), "<someone>'s answer:", or a speaking verb whose subject is someone
// other than the fact sheet's own speaker ("the trusted person answers", "you answer").
const SPEAKS = "(?:say|says|said|tell|tells|told|write|writes|wrote|answer|answers|answered|reply|replies|replied|explains|explained|recalls|shares|shared|adds|added|texts|texted)";
const OWNER_AFTER = /^\s*[,.]?\s*(?:[—–~-]\s*)?(?:my|her|his|their|our|your)\s+\p{L}+/iu;
const SUBJECT_AFTER = new RegExp(`^\\s*[,.]?\\s*(?:[—–~-]\\s*)?((?:the |a |an )?\\p{L}+(?:\\s+\\p{L}+){0,2})\\s+${SPEAKS}\\b`, "iu");
const ANSWER_BEFORE = /([\p{L}' ]{0,30}?)\b\p{L}+(?:'s|’s)\s+(?:answers?|words|reply|replies|response|text|message)\s*[:,]?\s*$/iu;
const SUBJECT_BEFORE = new RegExp(`(?:^|[^\\p{L}' ])([\\p{L}' ]{0,40}?)\\s*\\b${SPEAKS}(?:\\s+(?:me|us|her|him|them))?\\s*[:,]?\\s*$`, "iu");
const OWN_SPEAKER = /(?:trusted person|\byou)\s*$/i;
const NOUN_BEFORE = /(?:^(?:the|a|an|this|that|one)$|['’]s$)/i;
function spokenBySomeone(before, after) {
  if (OWNER_AFTER.test(after)) return true;
  const a = SUBJECT_AFTER.exec(after);
  if (a && !OWN_SPEAKER.test(a[1])) return true;
  const owner = ANSWER_BEFORE.exec(before);
  if (owner && !/trusted\s*$/i.test(owner[1])) return true;
  // "The answer:" and "Tom's answer:" use the verb as a noun: only a real subject speaks.
  const subject = SUBJECT_BEFORE.exec(before)?.[1].trim() || "";
  return Boolean(subject) && !NOUN_BEFORE.test(subject) && !OWN_SPEAKER.test(subject);
}
// A quoted phrase of three words or more is a person's quote when a name, a dash, a speaker
// ("my grandson", "her son told her", "My son's answer:") or "says" surrounds it, or when it
// speaks in the first person; the first person alone is not enough for words the fact sheet
// already holds ("the trusted person answers "Scam, Real or I'll call you""), but a speaker is.
export function attributedQuotes(text = "") {
  const s = String(text);
  const found = [];
  for (const m of s.matchAll(QUOTED)) {
    const inner = m[1];
    if (inner.split(/\s+/).filter(Boolean).length < 3) continue;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const before = s.slice(Math.max(0, m.index - 40), m.index);
    if (AFTER.test(after) || BEFORE.test(before) || spokenBySomeone(before, after) || (FIRST_PERSON.test(inner) && !inFactSheet(inner))) found.push(m[0]);
  }
  return found;
}

// ------------------------------------------------- claims and tone ---
const PRICES = [
  /[$€£¥₹]/, /\b(?:usd|eur|dollars?|euros?|cents)\b/i, /\bper\s+(?:month|year|week|day)\b/i, /\/\s?(?:mo|month|yr|year)\b/i,
  /\bfree (?:trial|of charge|plan)\b/i, /\bfor free\b/i, /\bat no (?:cost|charge)\b/i, /\bcosts? nothing\b/i,
];
const FEAR = [
  /\bact (?:now|fast)\b/i, /\b(?:don'?t|do not) wait\b/i, /\bhurry\b/i, /\burgent(?:ly)?\b/i, /\blast chance\b/i, /\blimited time\b/i,
  /\btoo late\b/i, /\blose everything\b/i, /\b(?:life|lifetime|retirement) savings\b/i, /\b(?:could|might) be next\b/i, /\bnext victim\b/i,
  /\bterrif(?:y|ying|ied)\b/i, /\bnightmare\b/i, /\bdevastat\w*/i, /\bhorrif\w*/i, /\bpanic\b/i, /\bwiped out\b/i, /\bprey\b/i,
  /\bscammers are (?:after|targeting|coming)\b/i, /!{2,}/,
];
const SHAMING = [
  /\bgullible\b/i, /\bnaive\b/i, /\beasy targets?\b/i, /\bsenile\b/i, /\bclueless\b/i, /\bhelpless\b/i, /\b(?:tech|computer)[- ]illiterate\b/i,
  /\bfalls? for (?:anything|everything)\b/i, /\bburden\b/i,
];
const firstMatch = (list, text) => list.map((re) => re.exec(text)).find(Boolean)?.[0];

// ------------------------------------------------ who is in the photo ---
// The parent the words name and the parent the photo brief shows, when each
// says it plainly: "mother" or "father", else null ("your parent", a couple,
// both, or neither named). Only the words' nouns count (Mom, Mother, Dad,
// Father, Grandma, Grandpa), never "her" or "his", so the check refuses only
// a plain contradiction: "Dad's email" over a photo brief of a mother.
const NAMES_MOTHER = /\b(?:mom|mother|mum|mama|grandma|grandmother)(?:'s|’s)?\b/i;
const NAMES_FATHER = /\b(?:dad|father|papa|grandpa|grandfather)(?:'s|’s)?\b/i;
const AGE = "(?:late |early |mid-?)?(?:sixties|seventies|eighties|nineties|[6-9]0s)";
const SHOWS_MOTHER = new RegExp(`\\b(?:mother|mom|mum|grandmother|grandma|(?:older|elderly|senior|retired) (?:woman|lady)|woman in her ${AGE})\\b`, "i");
const SHOWS_FATHER = new RegExp(`\\b(?:father|dad|grandfather|grandpa|(?:older|elderly|senior|retired) (?:man|gentleman)|man in his ${AGE})\\b`, "i");
const BOTH_SHOWN = /\b(?:couple|parents|grandparents)\b/i;
const which = (text, mother, father) => {
  const m = mother.test(text);
  const f = father.test(text);
  return m === f ? null : m ? "mother" : "father";
};
export function parentsNamed(words) {
  const said = PUBLIC_FIELDS.map((path) => fieldOf(words, path)).filter((v) => typeof v === "string").join("\n");
  const brief = typeof words?.photo_brief === "string" ? words.photo_brief : "";
  return { words: which(said, NAMES_MOTHER, NAMES_FATHER), photo: BOTH_SHOWN.test(brief) ? null : which(brief, SHOWS_MOTHER, SHOWS_FATHER) };
}

// ---------------------------------------------------------- the words ---
const str = (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim() : "");
// The model's answer in the shape C2 names, strings trimmed, the button as Facebook spells it.
export function normalizeWords(raw) {
  const w = raw && typeof raw === "object" ? raw : {};
  const landing = w.landing && typeof w.landing === "object" ? w.landing : {};
  return {
    headline: str(w.headline), primary_text: str(w.primary_text), description: str(w.description),
    cta: str(w.cta).toUpperCase().replace(/[\s-]+/g, "_"), photo_brief: str(w.photo_brief),
    landing: { headline: str(landing.headline), lead: str(landing.lead) },
  };
}
const fieldOf = (words, path) => path.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), words);
const length = (s) => [...s].length;

export function validateWords(words) {
  if (!words || typeof words !== "object") return { ok: false, problems: ["there are no words"] };
  const problems = [];
  for (const path of Object.keys(LIMITS)) {
    const value = fieldOf(words, path);
    const name = FIELD_NAMES[path];
    if (typeof value !== "string" || !value.trim()) { problems.push(`${name} is empty`); continue; }
    if (length(value) > LIMITS[path]) problems.push(`${name} is ${length(value)} characters long, at most ${LIMITS[path]}`);
    const brands = brandsIn(value);
    if (brands.length) problems.push(`${name} names ${brands.join(", ")}: no brand names`);
    if (!PUBLIC_FIELDS.includes(path)) continue;
    const facts = factNumbers();
    const unknown = [...new Set(numbersIn(value).filter((n) => !facts.has(n)))];
    if (unknown.length) problems.push(`${name} has ${unknown.join(", ")}, a number that is not in the fact sheet`);
    const quotes = attributedQuotes(value);
    if (quotes.length) problems.push(`${name} quotes a person (${quotes[0]}): no quotes or testimonials`);
    const guarantee = /\bguarantee(?:s|d)?\b/i.exec(value);
    if (guarantee) problems.push(`${name} says "${guarantee[0]}": nothing is guaranteed`);
    const price = firstMatch(PRICES, value);
    if (price) problems.push(`${name} mentions a price ("${price}")`);
    const fear = firstMatch(FEAR, value);
    if (fear) problems.push(`${name} has a fear or urgency line ("${fear}")`);
    const shame = firstMatch(SHAMING, value);
    if (shame) problems.push(`${name} shames older people ("${shame}")`);
  }
  const who = parentsNamed(words);
  if (who.words && who.photo && who.words !== who.photo) {
    problems.push(`the words name ${who.words === "mother" ? "Mom" : "Dad"} but the photo brief shows a ${who.photo}: the photo must show the parent the words name`);
  }
  if (!CTAS.includes(words.cta)) problems.push("the button must be Learn more (LEARN_MORE) or Sign up (SIGN_UP)");
  return { ok: problems.length === 0, problems };
}
