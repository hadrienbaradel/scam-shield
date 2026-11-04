// The corpus import of the public scam library (lib/libraryImport.js and
// scripts/library-import.mjs): the two parsers on three-line fixtures, the
// deterministic pick of spam samples not already in the library, the entry
// built from a sample (valid after redaction, links from the body, no
// verdict), the numbering, and the script's run on a fixture file with a
// stand-in classifier. No network, no model, no database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEntry, bodyHash, loadLibraryFiles } from "../lib/library.js";
import { CORPORA, parseUciSms, parseMishraSoni, pickSamples, messageFromSample, entryFromSample, sampleId, nextNumber } from "../lib/libraryImport.js";
import { importCorpus } from "../scripts/library-import.mjs";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const refs = async () => ({ families: await load("data/library/families.json"), sources: await load("data/library/sources.json") });
const sourceRow = async (id) => (await refs()).sources.find((s) => s.id === id);

const UCI = [
  "ham\tOk lar... Joking wif u oni...",
  "spam\tFree entry in 2 a wkly comp to win FA Cup final tkts 21st May 2005. Text FA to 87121 to receive entry question(std txt rate)T&C's apply 08452810075over18's",
  "spam\tURGENT! You have won a 1 week FREE membership in our £100,000 Prize Jackpot! Txt the word: CLAIM to No: 81010 T&C www.dbuk.net LCCLTD POBOX 4403LDNW1A7RW18",
].join("\n");

const MISHRA = [
  "LABEL,TEXT,URL,EMAIL,PHONE",
  "ham,\"Also sir, i sent you an email about the portal.\",No,No,No",
  "Smishing,\"Your tax refund of \"\"349.14\"\" is ready to be claimed.\nFollow the steps required. http://bit.do/Claim-Tax?user=jane@mail.com\",yes,No,No",
  "spam,BankOfAmerica Alert 137943. Please follow http://bit.do/cgjK and re-activate,yes,No,yes",
].join("\r\n");

test("parseUciSms reads label, tab, text and ignores what is not a message", () => {
  const rows = parseUciSms(`${UCI}\n\nnot a message line\n`);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { label: "ham", body: "Ok lar... Joking wif u oni..." });
  assert.equal(rows[1].label, "spam");
  assert.ok(rows[2].body.startsWith("URGENT!") && rows[2].body.endsWith("4403LDNW1A7RW18"), "the text is kept whole");
  assert.deepEqual(parseUciSms(""), []);
});

test("parseMishraSoni finds LABEL and TEXT by header, handles quoted commas, doubled quotes and newlines, lowercases the label", () => {
  const rows = parseMishraSoni(MISHRA);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { label: "ham", body: "Also sir, i sent you an email about the portal." });
  assert.equal(rows[1].label, "smishing", "Smishing becomes smishing");
  assert.equal(rows[1].body, 'Your tax refund of "349.14" is ready to be claimed.\nFollow the steps required. http://bit.do/Claim-Tax?user=jane@mail.com');
  assert.deepEqual(rows[2], { label: "spam", body: "BankOfAmerica Alert 137943. Please follow http://bit.do/cgjK and re-activate" });
  // Columns in another order, a short row, no rows at all.
  assert.deepEqual(parseMishraSoni("TEXT,LABEL\nhello there my friend,spam\nshort\n"), [{ label: "spam", body: "hello there my friend" }]);
  assert.deepEqual(parseMishraSoni("TEXT,PHONE\nno label column,No\n"), []);
  assert.deepEqual(parseMishraSoni(""), []);
});

test("pickSamples keeps spam and smishing once each, skips what the library holds, draws the same order for the same seed", () => {
  const rows = [
    { label: "ham", body: "Ok lar... Joking wif u oni... see you tonight" },
    { label: "spam", body: "WINNER! You have won a prize, call 09061701461 now to claim" },
    { label: "Smishing", body: "Your parcel is waiting, pay the fee at http://post-fee.example.com/x" },
    { label: "spam", body: "winner you have won a prize CALL 0906-170-1461 NOW to claim!!" },
    { label: "spam", body: "Your account GB29 NWBK 6016 1331 9268 19 is suspended, call us" },
    { label: "spam", body: "Your account FR76 3000 6000 0112 3456 7890 189 is suspended, call us" },
    { label: "spam", body: "Too short msg" },
    { label: "spam", body: "Refund of �305.96 waiting for you, claim it at http://gov-refund.example.com" },
    { label: "spam", body: "Free ringtone every week, reply STOP to end, 1.50 per msg" },
    { label: "spam", body: "x".repeat(10001) },
  ];
  const picked = pickSamples(rows);
  const bodies = picked.map((r) => r.body);
  assert.equal(picked.length, 4, "ham out, the repeated prize text once, the two account texts once, the short, the garbled and the too long out");
  assert.ok(bodies.includes("WINNER! You have won a prize, call 09061701461 now to claim"), "the first of two same messages stays");
  assert.ok(!bodies.some((b) => b.includes("FR76")), "the same message with another account number is a duplicate");
  assert.ok(picked.every((r) => typeof r.hash === "string" && r.hash.length === 64), "each sample carries its hash");
  assert.deepEqual(pickSamples(rows, { seed: 7 }).map((r) => r.body), pickSamples(rows, { seed: 7 }).map((r) => r.body), "same seed, same order");
  assert.notDeepEqual(pickSamples(rows, { seed: 1 }).map((r) => r.body), rows.filter((r) => bodies.includes(r.body)).map((r) => r.body), "shuffled, not file order");
  assert.equal(pickSamples(rows, { limit: 2 }).length, 2);
  assert.deepEqual(pickSamples(rows, { limit: 2 }).map((r) => r.body), picked.slice(0, 2).map((r) => r.body), "the limit cuts the same order");
  const already = new Set([bodyHash("Free ringtone every week reply STOP to end per msg")]);
  assert.ok(!pickSamples(rows, { existingHashes: already }).some((r) => r.body.startsWith("Free ringtone")), "a sample already in the library by bodyHash is skipped");
  assert.deepEqual(pickSamples([]), []);
  assert.deepEqual(pickSamples([null, {}]), []);
});

test("a sample already in the library by bodyHash is skipped against the real entries", async () => {
  const { entries } = await loadLibraryFiles();
  const existingHashes = new Set(entries.map((e) => bodyHash(e.message)));
  const rows = [{ label: "spam", body: entries[0].message.body }, { label: "spam", body: "A brand new scam text nobody has seen, pay at http://new.example.com now" }];
  assert.deepEqual(pickSamples(rows, { existingHashes }).map((r) => r.body), [rows[1].body]);
});

test("entryFromSample builds a valid entry: redacted, links from the body, English, no country, no verdict", async () => {
  const sample = { label: "spam", body: "Your card is blocked. Send your IBAN GB29 NWBK 6016 1331 9268 19 and call 08452810075 or visit http://bank-unlock.example.com/login?u=jane@mail.com. Help: support@fake-bank.com" };
  const source = await sourceRow("uci-sms");
  const classification = { family: "bank", brand: "A bank", lure: "Your card is blocked", ask: "Send bank details and call a number", language: "en", country: "GB" };
  const entry = entryFromSample(sample, { id: sampleId(CORPORA["uci-sms"].prefix, 7), source, classification, firstSeen: CORPORA["uci-sms"].seen });
  const errors = validateEntry(entry, await refs());
  assert.deepEqual(errors, [], "valid after redaction");
  assert.equal(entry.id, "lib-uci-007");
  assert.ok(entry.message.body.includes("[bank account number]") && !entry.message.body.includes("GB29"), "the IBAN goes");
  assert.ok(entry.message.body.includes("08452810075"), "the scammer's phone number stays");
  assert.ok(entry.message.body.includes("[someone]@fake-bank.com") && !entry.message.body.includes("support@"), "an address in the text becomes [someone]@domain");
  assert.deepEqual(entry.message.links, [{ text: null, href: "http://bank-unlock.example.com/login" }], "the link from the body, its query string gone");
  assert.deepEqual([entry.channel, entry.country, entry.language, entry.verdict, entry.status], ["sms", null, "en", null, "published"]);
  assert.deepEqual([entry.family, entry.brand, entry.lure, entry.ask], ["bank", "A bank", "Your card is blocked", "Send bank details and call a number"]);
  assert.deepEqual([entry.first_seen, entry.last_seen], ["2011-01-01", "2011-01-01"]);
  assert.deepEqual(entry.source, { id: "uci-sms", url: source.url, licence: "CC BY 4.0", attribution: source.attribution });
  assert.equal(entry.message.from, null);
  assert.equal(entry.message.subject, null);
});

test("entryFromSample with a phone number only, a sender, a repeated link and no classification", async () => {
  const source = await sourceRow("mishra-soni");
  const sample = { label: "smishing", from: "+44 7700 900123", body: "Call +44 7700 900123 now! https://pay-fee.example.com/a, again https://pay-fee.example.com/a." };
  const entry = entryFromSample(sample, { id: "lib-mishra-001", source, classification: { family: "delivery", brand: null, lure: "Call now", ask: "Pay a fee" }, firstSeen: "2022-01-01" });
  assert.deepEqual(validateEntry(entry, await refs()), []);
  assert.equal(entry.message.from, "+44 7700 900123", "a sender the corpus gives is kept");
  assert.ok(entry.message.body.includes("+44 7700 900123"), "a phone number is evidence and stays");
  assert.deepEqual(entry.message.links, [{ text: null, href: "https://pay-fee.example.com/a" }], "one link, once, without the trailing punctuation");
  const bare = entryFromSample({ body: "Twenty characters here, at least." }, { id: "lib-mishra-002", source, firstSeen: "2022-01-01" });
  assert.deepEqual([bare.family, bare.brand, bare.lure, bare.ask, bare.message.links], [null, null, "", "", []]);
  assert.ok(validateEntry(bare, await refs()).length > 0, "no family, not valid");
  assert.deepEqual(messageFromSample(null), { from: null, subject: null, body: "", links: [] });
});

test("sampleId pads to three digits and nextNumber follows the entries already there", () => {
  assert.equal(sampleId("lib-uci-", 1), "lib-uci-001");
  assert.equal(sampleId("lib-mishra-", 1234), "lib-mishra-1234");
  assert.equal(nextNumber(["lib-demo-a4", "lib-uci-003", "lib-uci-012", "lib-mishra-040", "lib-uci-x"], "lib-uci-"), 13);
  assert.equal(nextNumber(["lib-demo-a4"], "lib-uci-"), 1);
  assert.equal(nextNumber([], "lib-mishra-"), 1);
});

test("importCorpus reads a corpus file, classifies, writes numbered entries and skips what cannot be placed or does not validate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "library-import-"));
  try {
    await mkdir(join(dir, "entries"), { recursive: true });
    const { families, sources } = await refs();
    await writeFile(join(dir, "families.json"), JSON.stringify(families));
    await writeFile(join(dir, "sources.json"), JSON.stringify(sources));
    const file = join(dir, "corpus.txt");
    await writeFile(file, `${UCI}\nspam\tYour PIN 1234 was reset, confirm at http://a.example.com/x now please\nspam\tNo family for this one, a plain text message long enough\n`);
    const lines = [];
    const log = (s) => lines.push(s);
    const classify = async ({ message }) => (message.body.startsWith("No family")
      ? { family: null, brand: null, lure: "", ask: "" }
      : { family: "prize", brand: "Prize draw", lure: "You have won", ask: "Text a number", language: "en", country: "GB" });
    const first = await importCorpus({ source: "uci-sms", file, dir, limit: 2, classify, log });
    assert.deepEqual(first.written.map((e) => e.id), ["lib-uci-001", "lib-uci-002"]);
    assert.deepEqual(first.byFamily, { prize: 2 });
    assert.deepEqual((await readdir(join(dir, "entries"))).sort(), ["lib-uci-001.json", "lib-uci-002.json"]);
    const written = JSON.parse(await readFile(join(dir, "entries", "lib-uci-001.json"), "utf8"));
    assert.deepEqual(validateEntry(written, { families, sources }), []);
    assert.equal(written.source.id, "uci-sms");
    // A second run adds after the existing numbers and never rewrites what is there; the unplaceable sample is named.
    const second = await importCorpus({ source: "uci-sms", file, dir, limit: 10, classify, log });
    assert.deepEqual(second.written.map((e) => e.id), ["lib-uci-003"], "the two already in the library are skipped by hash; one left to place");
    assert.equal(second.skipped.unclassified, 1);
    assert.ok(lines.some((l) => /no family/.test(l)), "the skipped sample is named");
    assert.equal(second.calls, 2, "one call per candidate");
    assert.equal((await readdir(join(dir, "entries"))).length, 3);
    // --dry writes nothing; --family skips the model.
    await rm(join(dir, "entries", "lib-uci-003.json"));
    const dry = await importCorpus({ source: "uci-sms", file, dir, limit: 10, family: "prize", dry: true, log });
    assert.deepEqual(dry.written.map((e) => [e.id, e.family, e.lure]), [["lib-uci-003", "prize", ""], ["lib-uci-004", "prize", ""]], "the family flag places every sample, the unplaceable one too");
    assert.equal(dry.calls, 0);
    assert.equal((await readdir(join(dir, "entries"))).length, 2, "nothing written");
    // The classifier's answer that does not validate is skipped and named.
    const bad = await importCorpus({ source: "uci-sms", file, dir, limit: 10, classify: async () => ({ family: "prize", brand: null, lure: "x".repeat(300), ask: "" }), log });
    assert.deepEqual(bad.written, []);
    assert.equal(bad.skipped.invalid, 2, "the two samples left, both refused by validateEntry");
    assert.ok(lines.some((l) => /lure/.test(l)), "the reason is printed");
    // A model that fails once is retried; one that fails twice stops the run.
    let n = 0;
    const flaky = async (...a) => { n++; if (n === 1) throw new Error("down"); return classify(...a); };
    const retried = await importCorpus({ source: "uci-sms", file, dir, limit: 1, classify: flaky, log, dry: true });
    assert.equal(retried.written.length, 1);
    assert.equal(retried.calls, 2, "the failed call counts");
    await assert.rejects(importCorpus({ source: "uci-sms", file, dir, limit: 1, classify: async () => { throw new Error("down"); }, log, dry: true }), /down/);
    await assert.rejects(importCorpus({ source: "nope", file, dir, log }), /unknown source nope/);
    await mkdir(join(dir, "nosource"));
    await writeFile(join(dir, "nosource", "families.json"), JSON.stringify(families));
    await writeFile(join(dir, "nosource", "sources.json"), JSON.stringify(sources.filter((s) => s.id !== "mishra-soni")));
    await assert.rejects(importCorpus({ source: "mishra-soni", file, dir: join(dir, "nosource"), log }), /no mishra-soni row in .*sources\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("importCorpus with no classifier and no family needs a model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "library-import-"));
  try {
    const { families, sources } = await refs();
    await writeFile(join(dir, "families.json"), JSON.stringify(families));
    await writeFile(join(dir, "sources.json"), JSON.stringify(sources));
    const file = join(dir, "corpus.csv");
    await writeFile(file, MISHRA);
    await assert.rejects(importCorpus({ source: "mishra-soni", file, dir, limit: 1, log: () => {} }), /not configured/);
    await assert.rejects(importCorpus({ source: "mishra-soni", file, dir, limit: 1, family: "x", log: () => {} }), /unknown family x/);
    const out = await importCorpus({ source: "mishra-soni", file, dir, limit: 5, family: "bank", log: () => {} });
    assert.deepEqual(out.written.map((e) => [e.id, e.family, e.source.id, e.first_seen]), [["lib-mishra-001", "bank", "mishra-soni", "2022-01-01"], ["lib-mishra-002", "bank", "mishra-soni", "2022-01-01"]]);
    const refund = out.written.find((e) => e.message.body.includes("refund"));
    assert.deepEqual(refund.message.links, [{ text: null, href: "http://bit.do/Claim-Tax" }], "the address in the query string goes with it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
