// "Where did you get it?" on Paste the words (_product/specs/protection-menu.md,
// frame 1i): a pasted letter or a message from "somewhere else" reaches the
// pipeline as the channels letter and other. No pattern card lists them, so
// a reported campaign must still be found on the words alone, and the brand
// a letter speaks as must still be read from its opening words. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchCards } from "../lib/patterns.js";
import { detect } from "../lib/detector.js";

const cards = JSON.parse(readFileSync(new URL("../data/patterns/cards.json", import.meta.url), "utf8"));
const toll = cards.find((c) => c.id === "toll-sms-2026-10");
const words = "E-ZPass: unpaid toll balance of $4.15. Pay today to avoid a $50 late fee: https://ezpass-balance.test/pay";

test("a reported campaign is matched in a pasted letter or a message from somewhere else, as in the text it was reported for", () => {
  assert.deepEqual(toll.channels, ["sms"], "the card names the text messages only");
  for (const channel of ["sms", "letter", "other"]) {
    assert.deepEqual(matchCards({ channel, fromName: "", subject: "", body: words }, [toll]).map((c) => c.id), ["toll-sms-2026-10"], channel);
    const v = detect({ locale: "en-US", message: { channel, from: "", fromName: "", subject: "", body: words, links: [{ text: "https://ezpass-balance.test/pay", href: "https://ezpass-balance.test/pay" }], auth: "" },
      personalContext: {}, patternCards: [toll] });
    assert.ok(v.matched_pattern_ids.includes("toll-sms-2026-10"), `${channel}: the verdict names the campaign`);
    assert.equal(v.impersonated_brand, "E-ZPass", `${channel}: the brand it speaks as is read from its opening words`);
  }
  assert.deepEqual(matchCards({ channel: "whatsapp", body: words }, [toll]), [], "a channel cards do name still has to be on the card's list");
});
