// The "Checked:" chip under each reason on the senior's verdict card
// (_product/specs/senior-verdict-screen.md, behavior line 10): plain words
// for every evidence kind the verdict schema allows, in both languages,
// and no chip at all for a kind the engine never produces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_KINDS } from "../lib/schema.js";
import { evidenceWords, setLang } from "../public/js/i18n.js";

// Words a 75-year-old should never have to read on the card.
const JARGON = /\b(domain|dkim|spf|dmarc|url|header|headers|ip|dns|http|https|server|servers|authentication|metadata)\b/i;

test("every evidence kind in the verdict schema has plain English and French chip words", () => {
  for (const kind of EVIDENCE_KINDS) {
    const en = evidenceWords(kind, "en");
    const fr = evidenceWords(kind, "fr");
    assert.match(en ?? "", /^Checked: \S/, `English words for ${kind}`);
    assert.match(fr ?? "", /^Vérifié : \S/, `French words for ${kind}`);
    assert.ok(en.length <= 40 && fr.length <= 40, `${kind}: a chip stays short enough to wrap once at the largest size (${en.length}/${fr.length})`);
  }
  // Two kinds never share words: a chip must say which check it was.
  for (const l of ["en", "fr"]) {
    const all = EVIDENCE_KINDS.map((k) => evidenceWords(k, l));
    assert.equal(new Set(all).size, all.length, `${l}: every kind has its own words`);
  }
});

test("an unknown or missing evidence kind gives no chip rather than a wrong one", () => {
  for (const bad of ["rules", "detector", "", undefined, null, 42, {}, "constructor", "__proto__", "toString", "SENDER", "sender "]) {
    assert.equal(evidenceWords(bad, "en"), null, `en ${String(bad)}`);
    assert.equal(evidenceWords(bad, "fr"), null, `fr ${String(bad)}`);
  }
});

test("the chip words hold no technical term, acronym, address or percentage", () => {
  for (const kind of EVIDENCE_KINDS) {
    for (const l of ["en", "fr"]) {
      const words = evidenceWords(kind, l);
      assert.doesNotMatch(words, JARGON, `${l} ${kind}: "${words}"`);
      assert.doesNotMatch(words, /\b[A-Z]{2,}\b/, `${l} ${kind}: no acronym in "${words}"`);
      assert.doesNotMatch(words, /[@%{}<>_]/, `${l} ${kind}: no address, placeholder or markup in "${words}"`);
    }
  }
});

test("the chip follows the app's language, and an unknown language falls back to English", () => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try {
    setLang("fr");
    assert.equal(evidenceWords("sender"), "Vérifié : qui l'a envoyé");
    setLang("en");
    assert.equal(evidenceWords("sender"), "Checked: who sent it");
    assert.equal(evidenceWords("sender", "de"), "Checked: who sent it");
  } finally {
    delete globalThis.document;
  }
});
