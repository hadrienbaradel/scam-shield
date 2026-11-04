// Seeds the public scam library with the demo cases (spec line 3): every
// case of testcases/cases.json whose expected verdict is not Safe becomes
// one entry under data/library/entries/lib-demo-<id>.json, redacted with
// the persona's name, validated, and committed with the code. The family,
// the lure, the ask and the verdict lines are written here by hand, in
// English; the message keeps its own language. Re-running rewrites the
// same files, so the seed can change with the cases.
//
//   node scripts/library-seed.mjs
//
// No model, no network, no database.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateEntry, redactExample, LIBRARY_DIR } from "../lib/library.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const PROFILE = { francoise: { country: "FR", language: "fr" }, linda: { country: "US", language: "en" } };
const CHANNEL = { email: "email", sms: "sms", screenshot: "web", voice_transcript: "voice", whatsapp: "chat", social: "chat" };
const SEEN = "2026-10-27";

// The family of each case, then the brand when the case does not name it,
// and the lines a visitor reads: lure, ask, the verdict's headline and reasons.
const FAMILY = {
  A1: "utility", A2: "bank", A3: "utility", A3b: "utility", A4: "delivery",
  D1: "delivery", D2: "toll-fine", D3: "government", D4: "bank", D5: "government", D6: "tech-support", D7: "renewal", D8: "bank",
  B6: "sextortion", B7: "family-emergency", B8: "health", B9: "tech-support", B10: "account", B11: "recovery", B12: "romance",
  B1: "family-emergency", B2: "new-number", B13: "romance", B14: "investment", B15: "romance",
  C8: "bank", C9: "toll-fine", C10: "account",
  A6: "bank", A7: "bank", A8: "job", A9: "job",
};
const BRAND = { A6: "Société Générale", A7: "Société Générale", A8: "Adecco", A9: "Adecco", B9: "Norton" };
const LINES = {
  A1: { lure: "Your new phone bill is ready", ask: "Open the bill or contest a debit on a link that is not the provider's",
    headline: "This is not Bouygues Telecom.", reasons: ["The link goes to contestation-bouygues.test, not bouyguestelecom.fr.", "The real bills come from factures@bouyguestelecom.fr."] },
  A2: { lure: "Unusual activity, your account will be blocked", ask: "Confirm your bank codes on a copied sign-in page",
    headline: "This is not your bank.", reasons: ["The link is not on societegenerale.fr.", "A bank never asks for your codes by email."] },
  A3: { lure: "Your October Bbox bill is available", ask: "Sign in to a copied customer area to see the bill",
    headline: "This is not Bouygues Telecom.", reasons: ["The link goes to bbox-notifications.test, a copy of the customer area.", "The sender's address fails every check."] },
  A3b: { lure: "A 69.90 euro debit for a subscription you never took", ask: "Contest the debit on a page that asks for your online banking codes",
    headline: "This is not Bouygues Telecom, and the account number proves nothing.", reasons: ["The link goes to a copied bank page, not to the bank.", "The account number quoted leaked in a data breach; a scammer can know it."] },
  A4: { lure: "A parcel is waiting for you", ask: "Pay a small redelivery fee on a link",
    headline: "This is not Chronopost.", reasons: ["Chronopost never asks for a fee by text message.", "The link is not on chronopost.fr."] },
  D1: { lure: "Your package is on hold", ask: "Pay a $1.99 redelivery fee on a link",
    headline: "This is not USPS.", reasons: ["USPS never asks for a fee by text message.", "The link is not on usps.com."] },
  D2: { lure: "An unpaid toll with a big late fee if not paid today", ask: "Pay on a look-alike payment page",
    headline: "This is not E-ZPass.", reasons: ["The link is not on the toll agency's website.", "A small amount and a large late fee is the toll scam."] },
  D3: { lure: "Your Social Security benefits are suspended", ask: "Call a number now and verify your identity",
    headline: "This is not Social Security.", reasons: ["Social Security never suspends benefits by email.", "The sender's address is not ssa.gov."] },
  D4: { lure: "A fraud alert about a payment you did not make", ask: "Reply, then move your money to protect it",
    headline: "This is not Chase.", reasons: ["Chase never asks you to move money to protect it.", "The number is not the bank's."] },
  D5: { lure: "A federal agent says your savings are at risk", ask: "Move your money to a Bitcoin ATM and tell nobody",
    headline: "No agent asks this.", reasons: ["No government agency moves savings to Bitcoin.", "Secrecy and urgency are the marks of a scam."] },
  D6: { lure: "A security warning says the computer is infected", ask: "Call a support number shown in the pop-up",
    headline: "This is not Microsoft.", reasons: ["Microsoft never shows a phone number in a warning.", "Close the window; nothing is infected."] },
  D7: { lure: "Your Prime renewal failed", ask: "Update the payment information on a link",
    headline: "This is not Amazon.", reasons: ["The link goes to amazon-renewal-pay.test, not amazon.com.", "The sender's address fails every check."] },
  D8: { lure: "An unusual sign-in to your bank account", ask: "Verify your identity within 24 hours on a copied sign-in page",
    headline: "This is not Chase.", reasons: ["The link goes to chase-account-review.test, not chase.com.", "The page asks for the card number and the online banking password."] },
  B6: { lure: "Someone claims to have filmed you through your webcam", ask: "Pay $1,500 in Bitcoin within 48 hours",
    headline: "Nobody filmed you.", reasons: ["The old password quoted comes from a data breach.", "The message is sent from your own address, a trick."] },
  B7: { lure: "A relative abroad lost his wallet and asks for a favour", ask: "Buy gift cards and send the codes, in secret",
    headline: "Be careful: this may not be Mark.", reasons: ["Gift-card codes are the payment scammers ask for.", "The reply goes to another address; call Mark on his usual number."] },
  B8: { lure: "Renew your health card now", ask: "Pay a 1.99 euro fee on a link",
    headline: "This is not Ameli.", reasons: ["The health card is renewed for free, never by a link.", "The link is not on ameli.fr."] },
  B9: { lure: "Your antivirus renewed for $399", ask: "Call a number to cancel and get a refund",
    headline: "This is not Norton.", reasons: ["The refund call ends with remote access to the computer.", "The sender's address is not the company's."] },
  B10: { lure: "A grandchild sent you a verification code by mistake", ask: "Send back the six-digit code you just received",
    headline: "Do not send the code.", reasons: ["The code opens your WhatsApp account to whoever gets it.", "The number is not your grandchild's."] },
  B11: { lure: "A law firm can recover the money you lost", ask: "Wire an $850 fee first",
    headline: "Nobody recovers money for a fee paid first.", reasons: ["The fee is the scam, a second time.", "The sender's address is not a law firm's."] },
  B12: { lure: "A loving friend needs a small help", ask: "Invest $2,000 in crypto together",
    headline: "Be careful: love that asks for money.", reasons: ["The messages built affection and secrecy before the ask.", "A crypto investment with a friend met online is the romance scam."] },
  B1: { lure: "A grandchild had an accident and needs money now", ask: "Send 2,000 euros at once and keep it secret",
    headline: "This is probably not Hadrien.", reasons: ["The call comes from an unknown number.", "Urgency and secrecy are the marks of a scam; call him back on his usual number."] },
  B2: { lure: "A grandchild changed his number", ask: "Send $300 today, explanation later",
    headline: "Be careful: this may not be Ethan.", reasons: ["A new number that asks for money at once is the family scam.", "Call Ethan on his usual number first."] },
  B13: { lure: "A wrong number that turns into a friendly chat", ask: "Nothing yet; the conversation is the hook",
    headline: "Be careful: a wrong number that wants to chat.", reasons: ["Romance and investment scams start with a friendly wrong number.", "Nothing is asked today; something will be."] },
  B14: { lure: "A new friend's mentor made him thousands on a trading app", ask: "Start with $500 on the mentor's app",
    headline: "This is the investment scam.", reasons: ["The profits shown are fake; the first deposit is never seen again.", "The friendship started with a wrong number and moved to WhatsApp."] },
  B15: { lure: "A stranger's message request with a sports headline, out of the blue", ask: "Nothing yet; a reply opens the conversation",
    headline: "Be careful: a stranger wrote to you first.", reasons: ["Someone you do not know wrote first, about sports, with no reason to.", "Romance and investment scams start with a harmless first message."] },
  C8: { lure: "A new device connected to your bank account", ask: "Call the number on the back of your card if it was not you",
    headline: "Be careful: a real alert, so call your bank yourself.", reasons: ["The message is genuine and asks for nothing on a link.", "Use the number on your card, never a number in a message."] },
  C9: { lure: "A traffic fine was issued for your vehicle", ask: "Look it up yourself on the agency's website with the paper notice",
    headline: "Be careful: a real notice; check it yourself.", reasons: ["The message is genuine and sends you to antai.gouv.fr by yourself.", "Pay a fine only on the agency's own website."] },
  C10: { lure: "Your customer area password was changed", ask: "Secure the account if you did not change it",
    headline: "Be careful: a real notice; sign in by yourself.", reasons: ["The message is genuine and passes every check.", "If you did not change the password, open the provider's app yourself."] },
  A6: { lure: "A suspicious 700 euro card transaction", ask: "Report it on an anti-fraud link",
    headline: "This is not Société Générale.", reasons: ["The sender writes from a personal AOL mailbox with a look-alike name.", "The anti-fraud link goes to a site registered the same day."] },
  A7: { lure: "A new message in your bank's secure mailbox", ask: "Sign in through a link that passes by a free website builder",
    headline: "This is not SG.", reasons: ["The sender is a Brazilian business mailbox, not the bank.", "The link passes through medium.com to a free website builder."] },
  A8: { lure: "A recruiter matched your profile to a remote job", ask: "Apply and book a call on a link that borrows the agency's name",
    headline: "This is not Adecco.", reasons: ["The reply address and the link borrow the name Adecco on other domains.", "Sent through an invoicing service, so it passes the mail checks."] },
  A9: { lure: "A recruiter matched your profile to a remote job", ask: "Apply and book a call on a link registered days ago",
    headline: "This is not Adecco.", reasons: ["The link's domain was registered 17 days before the email.", "The reply address borrows the name Adecco on another domain."] },
};

const looksLikePhone = (s = "") => /^\+?[\d\s().-]{7,}$/.test(s) && /\d{4}/.test(s.replace(/\D/g, ""));
const dateOf = (c) => (typeof c.message.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(c.message.date) ? c.message.date.slice(0, 10) : SEEN);

export function entryFromCase(c, profile) {
  const m = c.message;
  const channel = CHANNEL[m.channel] ?? "email";
  // A text, a chat or a call comes from a number: the demo keeps the number in fromName.
  const from = channel !== "email" && looksLikePhone(m.fromName || "") ? m.fromName : m.from || null;
  const lines = LINES[c.id];
  const seen = dateOf(c);
  return {
    id: `lib-demo-${c.id.toLowerCase()}`,
    family: FAMILY[c.id], channel,
    country: PROFILE[c.profile].country, language: PROFILE[c.profile].language,
    brand: BRAND[c.id] ?? m.claimedBrand ?? null,
    lure: lines.lure, ask: lines.ask,
    message: redactExample({ from, subject: m.subject || null, body: m.body, links: (m.links || []).map((l) => ({ text: l.text ?? null, href: l.href })) },
      { recipientName: profile.userName }),
    first_seen: seen, last_seen: seen,
    source: { id: "prudence-demo", url: "https://github.com/hadrienbaradel/scam-shield/blob/main/testcases/cases.json", licence: "CC BY 4.0", attribution: "Prudence demo cases (Scam Shield), CC BY 4.0" },
    verdict: { verdict: c.expected, headline: lines.headline, reasons: lines.reasons },
    status: "published",
  };
}

export async function seedLibrary({ dir = LIBRARY_DIR, log = console.log } = {}) {
  const { cases } = await load("testcases/cases.json");
  const profiles = { francoise: await load("data/profiles/francoise.json"), linda: await load("data/profiles/linda.json") };
  // The two lists read as files, not through loadLibraryFiles: the entries being rewritten may fail a rule that changed.
  const families = JSON.parse(await readFile(join(dir, "families.json"), "utf8"));
  const sources = JSON.parse(await readFile(join(dir, "sources.json"), "utf8"));
  await mkdir(join(dir, "entries"), { recursive: true });
  const written = [];
  for (const c of cases.filter((x) => x.expected !== "safe")) {
    if (!FAMILY[c.id] || !LINES[c.id]) throw new Error(`${c.id}: no family or lines in scripts/library-seed.mjs`);
    const entry = entryFromCase(c, profiles[c.profile]);
    const errors = validateEntry(entry, { families, sources });
    if (errors.length) throw new Error(`${c.id}: ${errors.join("; ")}`);
    for (const w of errors.warnings) log(`  ${entry.id}: ${w}`);
    await writeFile(join(dir, "entries", `${entry.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
    written.push(entry.id);
  }
  log(`Wrote ${written.length} entries to ${join(dir, "entries")}`);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedLibrary();
}
