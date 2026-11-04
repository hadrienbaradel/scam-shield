// The public scam library, the pure part (lib/library.js): the 21
// families, the entry schema and what validateEntry names, redaction (what
// goes, what stays as evidence), the body hash, the indicators behind the
// suspect list, the filters, the export and the file loader. No network,
// no database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHANNELS, validateEntry, redactExample, cleanHref, bodyHash, indicatorsOf, filterEntries, exportLibrary, loadLibraryFiles } from "../lib/library.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const FAMILY_IDS = ["delivery", "bank", "government", "tech-support", "family-emergency", "new-number", "romance", "investment", "prize",
  "charity", "job", "rental", "renewal", "toll-fine", "utility", "account", "sextortion", "invoice", "marketplace", "health", "recovery"];

// The example entry of the plan (docs/plans/2026-11-04-public-database.md).
export const EXAMPLE = {
  id: "lib-demo-a4", family: "delivery", channel: "sms", country: "FR", language: "fr", brand: "Chronopost",
  lure: "a parcel is waiting", ask: "pay a small redelivery fee on a link",
  message: { from: "+33 7 00 00 00 01", subject: null, body: "Chronopost : votre colis est en attente. Payez 1,99 € de frais pour le reprogrammer.",
    links: [{ text: "chronopost.fr", href: "https://chronopost-colis.test/pay" }] },
  first_seen: "2026-10-20", last_seen: "2026-10-20",
  source: { id: "prudence-demo", url: null, licence: "CC BY 4.0", attribution: "Prudence demo cases" },
  verdict: { verdict: "scam", headline: "This is not Chronopost.", reasons: ["The link is not on chronopost.fr.", "A fee by text message is the parcel scam."] },
  status: "published",
};
const refs = async () => ({ families: await load("data/library/families.json"), sources: await load("data/library/sources.json") });
const withMessage = (patch) => ({ ...EXAMPLE, message: { ...EXAMPLE.message, ...patch } });

test("the 21 families carry both names, both definitions and their references", async () => {
  const families = await load("data/library/families.json");
  assert.deepEqual(families.map((f) => f.id), FAMILY_IDS);
  for (const f of families) {
    for (const lang of ["en", "fr"]) {
      assert.ok(f.name?.[lang]?.trim(), `${f.id}: name.${lang}`);
      assert.ok(f.definition?.[lang]?.trim(), `${f.id}: definition.${lang}`);
    }
    assert.deepEqual(Object.keys(f.refs).sort(), ["fr", "ftc", "ic3", "nfib", "scamclassifier", "scamwatch"], `${f.id}: the six references`);
  }
  const sources = await load("data/library/sources.json");
  assert.ok(sources.find((s) => s.id === "prudence-demo")?.licence === "CC BY 4.0");
  assert.deepEqual(CHANNELS, ["email", "sms", "chat", "voice", "web", "letter"]);
});

test("validateEntry accepts the example entry and names what is wrong", async () => {
  const ctx = await refs();
  assert.deepEqual(validateEntry(EXAMPLE, ctx), []);
  const { family, ...noFamily } = EXAMPLE;
  assert.ok(validateEntry(noFamily, ctx).includes("missing family"));
  assert.ok(validateEntry({ ...EXAMPLE, family: "x" }, ctx).includes("unknown family x"));
  assert.ok(validateEntry({ ...EXAMPLE, channel: "fax" }, ctx).some((e) => /channel/.test(e)), "channel fax");
  assert.ok(validateEntry(withMessage({ body: "Hello" }), ctx).some((e) => /body/.test(e)), "a 5-character body");
  assert.ok(validateEntry(withMessage({ body: "x".repeat(10001) }), ctx).some((e) => /body/.test(e)), "a body over 10,000 characters");
  assert.ok(validateEntry({ ...EXAMPLE, source: { ...EXAMPLE.source, id: "nope" } }, ctx).some((e) => /source/.test(e)), "an unknown source");
  assert.ok(validateEntry(withMessage({ body: "Un prélèvement sur votre compte FR76 3000 6000 0112 3456 7890 189 sera effectué." }), ctx).includes("body carries personal data"));
  assert.ok(validateEntry(withMessage({ subject: "Pour Françoise Dupont, code 123456" }), ctx).includes("body carries personal data"), "the subject too");
  assert.ok(validateEntry({ ...EXAMPLE, first_seen: "20/10/2026" }, ctx).some((e) => /first_seen/.test(e)), "a date not YYYY-MM-DD");
  assert.ok(validateEntry({ ...EXAMPLE, last_seen: "2026-10-19" }, ctx).some((e) => /last_seen/.test(e)), "last_seen before first_seen");
  assert.ok(validateEntry({ ...EXAMPLE, id: "Demo A4" }, ctx).some((e) => /id/.test(e)), "an id with spaces");
  assert.ok(validateEntry({ ...EXAMPLE, country: "France" }, ctx).some((e) => /country/.test(e)), "a country not alpha-2");
  assert.ok(validateEntry({ ...EXAMPLE, language: "FR" }, ctx).some((e) => /language/.test(e)), "a language not ISO 639-1");
  assert.ok(validateEntry({ ...EXAMPLE, verdict: { verdict: "safe", headline: "x", reasons: [] } }, ctx).some((e) => /verdict/.test(e)), "a safe verdict is no library entry");
  assert.deepEqual(validateEntry({ ...EXAMPLE, verdict: null, country: null, language: null, brand: null }, ctx), [], "nulls where allowed");
  assert.ok(validateEntry({ ...EXAMPLE, extra: 1 }, ctx).some((e) => /extra/.test(e)), "no unknown field");
  assert.deepEqual(validateEntry(null, ctx), ["entry is not an object"]);
});

test("redactExample keeps the evidence and removes what belongs to the recipient", () => {
  const message = {
    from: "alerts@secure-chase-login.com", subject: "Françoise, your code 123456 expires",
    body: "Françoise, call us at +1 555-013-0199 about account FR76 3000 6000 0112 3456 7890 189, card 4111 1111 1111 1111 and SSN 123-45-6789. Reply to linda@gmail.com with your code 654321.",
    links: [{ text: "chase.com", href: "https://secure-chase-login.com/verify" }],
  };
  const r = redactExample(message, { recipientName: "Françoise" });
  assert.equal(r.from, message.from, "the sender stays");
  assert.deepEqual(r.links, message.links, "the links stay");
  assert.ok(r.body.includes("+1 555-013-0199"), "a phone number in the body stays");
  assert.ok(r.body.includes("[bank account number]") && !r.body.includes("FR76"));
  assert.ok(r.body.includes("[card number]") && !r.body.includes("4111"));
  assert.ok(r.body.includes("[social security number]") && !r.body.includes("123-45-6789"));
  assert.ok(r.body.includes("code [code]") && !r.body.includes("654321"));
  assert.ok(r.body.includes("[someone]@gmail.com") && !r.body.includes("linda@"));
  assert.ok(r.body.startsWith("[name], call") && !r.body.includes("Françoise"));
  assert.equal(r.subject, "[name], your code [code] expires");
  assert.equal(redactExample({ body: "Hello there" }).subject, null, "no subject stays no subject");
  assert.equal(redactExample({ body: "Hi Al, pay now" }, { recipientName: "Al" }).body, "Hi Al, pay now", "a name under three letters is left alone");
  // An IBAN in any case, with dots or dashes between its groups.
  assert.equal(redactExample({ body: "Compte fr76.3000.6000.0112.3456.7890.189 débité" }).body, "Compte [bank account number] débité");
  assert.equal(redactExample({ body: "Account de89-3704-0044-0532-0130-00 please" }).body, "Account [bank account number] please");
  // A one-time code written in groups, or a few words after the word.
  assert.equal(redactExample({ body: "Votre code : 12 34 56 expire bientôt" }).body, "Votre code : [code] expire bientôt");
  assert.equal(redactExample({ body: "Votre code de validation est 123456, ne le partagez pas" }).body, "Votre code de validation est [code], ne le partagez pas");
  assert.equal(redactExample({ body: "Enter the OTP 98-76-54 on the page" }).body, "Enter the OTP [code] on the page");
  assert.equal(redactExample({ body: "It's the 6-digit code you just received." }).body, "It's the 6-digit code you just received.", "a code only spoken of stays");
  assert.equal(redactExample({ body: "Your codes: 123456 and 654321" }).body, "Your codes: [code] and 654321", "the plural");
  assert.equal(redactExample({ body: "Enter code123456 now" }).body, "Enter code[code] now", "digits glued to the word");
  assert.equal(redactExample({ body: "votre code de validation est 12 34 56 merci" }).body, "votre code de validation est [code] merci");
  assert.equal(redactExample({ body: "The parcel was pinned to 2026 shelves" }).body, "The parcel was pinned to 2026 shelves", "a longer word is not the word");
  // A password the scammer quotes, in either language; a word after "password is" that is not a password stays.
  assert.equal(redactExample({ body: "Your old password is: sunshine42. Pay now." }).body, "Your old password is: [password]. Pay now.");
  assert.equal(redactExample({ body: "votre mot de passe : soleil42 a fuité" }).body, "votre mot de passe : [password] a fuité");
  assert.equal(redactExample({ body: "Password=Tr0ub4dor&3 was leaked" }).body, "Password=[password] was leaked");
  assert.equal(redactExample({ body: "Your password is expired. Nouveau mot de passe enregistré. A password must be changed." }).body,
    "Your password is expired. Nouveau mot de passe enregistré. A password must be changed.");
  // Links keep their scheme, host and path; their text is redacted like the body.
  const links = redactExample({ body: "Click to verify your account now", links: [
    { text: "Open as linda@gmail.com", href: "https://secure-chase-login.com/verify?email=linda@gmail.com&t=abc#top" }, { text: null, href: "https://x.test/a/b" }] }).links;
  assert.deepEqual(links, [{ text: "Open as [someone]@gmail.com", href: "https://secure-chase-login.com/verify" }, { text: null, href: "https://x.test/a/b" }]);
  assert.equal("links" in redactExample({ body: "no links at all here" }), false, "no links key added");
});

test("cleanHref keeps the scheme, host and path; credentials, an address and a token in the path go", () => {
  assert.equal(cleanHref("https://a:b@evil.example/x"), "https://evil.example/x");
  assert.equal(cleanHref("https://evil.example/verify/linda@gmail.com"), "https://evil.example/verify/[someone]@gmail.com");
  assert.equal(cleanHref("https://evil.example/t/3f9a0c1e8b7d4a2f9c6e1b0d5a8f7e3c2b1a0d9e"), "https://evil.example/t/[token]");
  // Double-encoded, and a bad escape next to a valid one: the address still goes.
  assert.equal(cleanHref("https://evil.example/v/linda%2540gmail.com"), "https://evil.example/v/[someone]@gmail.com");
  assert.equal(cleanHref("https://evil.example/v/linda%40gmail.com%ZZ"), "https://evil.example/v/[someone]@gmail.com%ZZ");
  // A token stays a token whether it is read raw or decoded.
  assert.equal(cleanHref("https://evil.example/t/3f9a0c1e8b7d4a2f9c6e1b0d5a8f7e3c2b1a0d9%65"), "https://evil.example/t/[token]");
  assert.equal(cleanHref("https://evil.example/verify-linda@gmail.com-now"), "https://evil.example/[someone]@gmail.com-now", "an address inside a segment (a dash belongs to the local part, as in the body)");
  assert.equal(cleanHref("https://evil.example/u/linda%40gmail.com/x"), "https://evil.example/u/[someone]@gmail.com/x", "a percent-encoded address");
  assert.equal(cleanHref("https://evil.example/caf%C3%A9/menu%ZZ"), "https://evil.example/caf%C3%A9/menu%ZZ", "encoding that hides no address stays as written, bad encoding too");
  assert.equal(cleanHref("https://evil.example/s/aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRva2Vu"), "https://evil.example/s/[token]", "a base64 run");
  assert.equal(cleanHref("https://evil.example/fully-remote-integrated-marketing-manager-position/invite/REDACTED"),
    "https://evil.example/fully-remote-integrated-marketing-manager-position/invite/REDACTED", "words with dashes and a short id stay");
  assert.equal(cleanHref("https://u46337456.ct.sendgrid.net/ls/click?upn=abc#frag"), "https://u46337456.ct.sendgrid.net/ls/click");
  assert.equal(cleanHref("https://evil.example"), "https://evil.example", "no path");
  assert.equal(cleanHref("chronopost.fr"), "chronopost.fr", "not a URL: left as is");
  assert.equal(cleanHref(null), "");
});

test("validateEntry refuses a link that redaction would change, or link text with an address", async () => {
  const ctx = await refs();
  const link = (href, text = "chronopost.fr") => withMessage({ links: [{ text, href }] });
  const LINK_ERROR = "links must carry no query string, fragment, credentials or token";
  assert.ok(validateEntry(link("https://chronopost-colis.test/pay?id=12"), ctx).includes(LINK_ERROR));
  assert.ok(validateEntry(link("https://chronopost-colis.test/pay#x"), ctx).includes(LINK_ERROR));
  assert.ok(validateEntry(link("https://a:b@evil.example/x"), ctx).includes(LINK_ERROR), "credentials");
  assert.ok(validateEntry(link("https://evil.example/verify/linda@gmail.com"), ctx).includes(LINK_ERROR), "an address in the path");
  assert.ok(validateEntry(link("https://evil.example/t/3f9a0c1e8b7d4a2f9c6e1b0d5a8f7e3c2b1a0d9e"), ctx).includes(LINK_ERROR), "a token in the path");
  assert.ok(validateEntry(link("https://evil.example/verify-linda@gmail.com-now"), ctx).includes(LINK_ERROR), "an address inside a segment");
  assert.ok(validateEntry(link("https://evil.example/u/linda%40gmail.com"), ctx).includes(LINK_ERROR), "a percent-encoded address");
  assert.deepEqual(validateEntry(link("https://evil.example/caf%C3%A9/menu"), ctx), [], "encoding that hides no address passes");
  assert.deepEqual(validateEntry(link("https://evil.example/verify/[someone]@gmail.com/t/[token]"), ctx), [], "the redacted form passes");
  assert.ok(validateEntry(link("https://chronopost-colis.test/pay", "reply to linda@gmail.com"), ctx).includes("link text carries personal data"));
  assert.deepEqual(validateEntry(link("https://chronopost-colis.test/pay", "reply to [someone]@gmail.com"), ctx), [], "the redacted form passes");
  assert.deepEqual(validateEntry(link("https://chronopost-colis.test/pay", null), ctx), [], "no text is fine");
});

test("validateEntry warns when the text may still carry a name; a warning blocks nothing", async () => {
  const ctx = await refs();
  const warningsOf = (patch) => validateEntry(withMessage(patch), ctx).warnings;
  assert.deepEqual(warningsOf({ body: "Madame, votre nouvelle facture est disponible dans votre espace client." }), [], "a greeting alone is no name");
  assert.deepEqual(warningsOf({ body: "Dear Customer, we noticed a sign-in from a new device. Hi Grandma, sorry." }), [], "the usual stand-ins are not names");
  assert.deepEqual(warningsOf({ body: "Françoise, call us today about your account please." }), ["may carry a name: Françoise"], "a capitalised word opening a sentence before a comma");
  assert.deepEqual(warningsOf({ body: "Hi there. Bonjour Thomas, votre colis est en attente." }), ["may carry a name: Thomas"], "a greeting then a capitalised word");
  assert.deepEqual(warningsOf({ subject: "Dear Linda", body: "Your package is on hold, pay the fee today. Jessica, we met at the club." }), ["may carry a name: Linda", "may carry a name: Jessica"], "the subject too, once each");
  const errs = validateEntry(withMessage({ body: "Hi Linda, your package is on hold." }), ctx);
  assert.deepEqual(errs, [], "a warning is not an error");
  assert.deepEqual(errs.warnings, ["may carry a name: Linda"]);
  assert.deepEqual(validateEntry(null, ctx).warnings, []);
});

test("bodyHash ignores case, digits, punctuation and spacing", () => {
  assert.equal(bodyHash({ body: "Pay $1.99 now!" }), bodyHash({ body: "pay 1 99 NOW" }));
  assert.equal(bodyHash("Pay $1.99 now!"), bodyHash({ body: "  pay   now " }), "a string works too");
  assert.notEqual(bodyHash({ body: "Pay now" }), bodyHash({ body: "Pay later" }));
  assert.match(bodyHash({}), /^[0-9a-f]{64}$/);
});

test("indicatorsOf: the scam's domains, sender and phones, never a reserved host, a placeholder or a brand's real address", () => {
  const a4 = indicatorsOf(EXAMPLE);
  assert.deepEqual(a4, { domains: [], senders: [], phones: ["+33700000001"] }, ".test is reserved; the sender number is the phone");
  const bouygues = indicatorsOf(withMessage({ from: "service@contestation-bouygues.example", body: "Votre facture est disponible sur https://contestation-bouygues.example/facture" }));
  assert.deepEqual(bouygues, { domains: [], senders: [], phones: [] }, ".example is reserved");
  const chase = indicatorsOf(withMessage({
    from: "alerts@secure-chase-login.com",
    body: "Verify at https://secure-chase-login.com/verify or http://WWW.Chase-Verify.net/x, call 1-555-0166 or +1 555-013-0199. Real site: https://www.chase.com/",
    links: [{ text: "chase.com", href: "https://secure-chase-login.com/verify?x=1" }, { text: "img", href: "https://10.0.0.1/pixel" }, { text: "help", href: "https://chase.com/help" }],
  }));
  assert.deepEqual(chase.senders, ["alerts@secure-chase-login.com"]);
  assert.deepEqual(chase.domains, ["secure-chase-login.com", "chase-verify.net"], "once each, lowercased, www. stripped, the private IP and chase.com's own address left out");
  assert.deepEqual(chase.phones, ["15550166", "+15550130199"]);
  assert.deepEqual(indicatorsOf(withMessage({ from: "[someone]@gmail.com", body: "Write to [someone]@gmail.com now please" })).senders, [], "a redacted address is nobody");
  assert.deepEqual(indicatorsOf(withMessage({ from: "statements@chase.com", links: [] })).senders, [], "a spoofed real address is not a suspect");
  assert.deepEqual(indicatorsOf(withMessage({ from: "Bouygues Telecom", links: [] })), { domains: [], senders: [], phones: [] }, "a display name is neither");
  assert.deepEqual(indicatorsOf(withMessage({ from: "+33 6 12 34 56 78", body: "Rappelez le 06 98 76 54 32 ou le 0033612345678." })).phones, ["+33612345678", "0698765432", "0033612345678"]);
  const careful = { ...EXAMPLE, verdict: { verdict: "be_careful", headline: "x", reasons: [] }, message: { ...EXAMPLE.message, from: "avis@antai-notice.org", links: [{ text: "x", href: "https://antai-notice.org/" }] } };
  assert.deepEqual(indicatorsOf(careful), { domains: [], senders: [], phones: [] }, "a Be careful entry may be genuine: it accuses nobody");
  assert.deepEqual(indicatorsOf({ ...careful, verdict: null }).domains, ["antai-notice.org"], "a sample without a verdict counts");
  assert.deepEqual(indicatorsOf({}), { domains: [], senders: [], phones: [] });
});

const entries = [
  EXAMPLE,
  { ...EXAMPLE, id: "lib-demo-d1", country: "US", language: "en", brand: "USPS", lure: "a package is on hold", first_seen: "2026-10-22", last_seen: "2026-10-22",
    message: { ...EXAMPLE.message, body: "USPS: your package is on hold. Pay a $1.99 redelivery fee today." } },
  { ...EXAMPLE, id: "lib-demo-a2", family: "bank", channel: "email", brand: "Société Générale", lure: "unusual activity", ask: "confirm your codes", first_seen: "2026-10-25", last_seen: "2026-10-25",
    message: { from: "alertes@sg-securite.test", subject: "Sécurisez votre compte", body: "Madame, une activité inhabituelle a été détectée. Confirmez vos codes.", links: [] } },
];

test("filterEntries narrows by family, channel, country, language and words", () => {
  const ids = (f) => filterEntries(entries, f).map((e) => e.id);
  assert.deepEqual(ids({}), ["lib-demo-a4", "lib-demo-d1", "lib-demo-a2"]);
  assert.deepEqual(ids({ family: "bank" }), ["lib-demo-a2"]);
  assert.deepEqual(ids({ channel: "sms" }), ["lib-demo-a4", "lib-demo-d1"]);
  assert.deepEqual(ids({ country: "us" }), ["lib-demo-d1"], "country case does not matter");
  assert.deepEqual(ids({ language: "fr" }), ["lib-demo-a4", "lib-demo-a2"]);
  assert.deepEqual(ids({ q: "usps" }), ["lib-demo-d1"], "the brand");
  assert.deepEqual(ids({ q: "CODES" }), ["lib-demo-a2"], "the ask and the body, any case");
  assert.deepEqual(ids({ q: "Sécurisez" }), ["lib-demo-a2"], "the subject");
  assert.deepEqual(ids({ q: "parcel is" }), ["lib-demo-a4"], "the lure");
  assert.deepEqual(ids({ family: "delivery", q: "hold" }), ["lib-demo-d1"], "filters combine");
  assert.deepEqual(ids({ q: "   " }), ["lib-demo-a4", "lib-demo-d1", "lib-demo-a2"], "blank words filter nothing");
});

test("exportLibrary carries the licence, a timestamp and everything else as is", () => {
  const families = [{ id: "delivery" }];
  const sources = [{ id: "prudence-demo" }];
  const out = exportLibrary({ families, sources, entries });
  assert.equal(out.licence, "CC BY 4.0");
  assert.ok(!Number.isNaN(Date.parse(out.generated)));
  assert.deepEqual(Object.keys(out), ["licence", "generated", "families", "sources", "entries"]);
  assert.equal(out.entries.length, 3);
});

test("loadLibraryFiles reads a folder, validates every entry and names a bad file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "library-"));
  try {
    await mkdir(join(dir, "entries"));
    await writeFile(join(dir, "families.json"), JSON.stringify(await load("data/library/families.json")));
    await writeFile(join(dir, "sources.json"), JSON.stringify(await load("data/library/sources.json")));
    await writeFile(join(dir, "entries", "lib-demo-a4.json"), JSON.stringify(EXAMPLE));
    await writeFile(join(dir, "entries", "notes.txt"), "not an entry");
    const lib = await loadLibraryFiles(dir);
    assert.equal(lib.families.length, 21);
    assert.equal(lib.sources.length, 2);
    assert.deepEqual(lib.entries, [EXAMPLE]);
    await writeFile(join(dir, "entries", "lib-demo-bad.json"), JSON.stringify({ ...EXAMPLE, id: "lib-demo-bad", family: "x" }));
    await assert.rejects(loadLibraryFiles(dir), /lib-demo-bad\.json: unknown family x/);
    await writeFile(join(dir, "entries", "lib-demo-bad.json"), JSON.stringify(EXAMPLE));
    await assert.rejects(loadLibraryFiles(dir), /lib-demo-bad\.json: id lib-demo-a4 is already used/, "two files, one id");
    await writeFile(join(dir, "entries", "lib-demo-bad.json"), "{ not json");
    await assert.rejects(loadLibraryFiles(dir), /lib-demo-bad\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const real = await loadLibraryFiles();
  assert.ok(real.families.length === 21 && Array.isArray(real.entries), "the repo's own folder loads");
});
