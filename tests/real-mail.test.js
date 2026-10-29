// Real-inbox shapes. The PRD seed cases carry hand-set fields (claimedBrand,
// mock link inspection) that live Gmail never provides; these messages look
// exactly like what src/google/gmail.js normalizes from a real mailbox.
// Everyday legitimate mail must never be Scam; real-shaped scams must still be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "../lib/detector.js";
import { emptyContext } from "../lib/context.js";

const PASS = "spf=pass dkim=pass dmarc=pass";
const ctx = { ...emptyContext("Linda"), orders: [{ merchant: "Amazon", carrier: "Amazon Logistics", tracking: "TBA123456789012", date: "2026-10-20" }] };
const run = (message, context = ctx) => detect({ locale: "en-US", message: { channel: "email", ...message }, personalContext: context });

const LEGIT = [
  { name: "shop receipt mentioning a purchase", m: { fromName: "Etsy", from: "transaction@etsy.com", auth: PASS,
    subject: "Your purchase from CozyKnits", body: "Thanks for your purchase! Order #3141. We'll email you when it ships.",
    links: [{ text: "View your order", href: "https://www.etsy.com/your/purchases/3141" }, { text: "Shop", href: "https://www.etsy.com" }] } },
  { name: "Google Groups digest", m: { fromName: "Garden Club via Google Groups", from: "garden-club@googlegroups.com", auth: PASS,
    subject: "Digest for garden-club@googlegroups.com - 3 updates in 1 topic", body: "Tulip bulbs swap on Saturday at 10am.",
    links: [{ text: "Unsubscribe", href: "https://groups.google.com/g/garden-club/unsubscribe" }] } },
  { name: "newsletter through its email-service provider", m: { fromName: "The Boston Globe", from: "newsletters@globe.com", auth: PASS,
    subject: "Today's headlines", body: "Red Sox name new manager. Read more inside.",
    links: [{ text: "Read more", href: "https://click.e.globe.com/?qs=abc" }, { text: "Unsubscribe", href: "https://click.e.globe.com/u?qs=def" }] } },
  { name: "retailer advert naming another brand in the subject", m: { fromName: "Best Buy", from: "BestBuyInfo@emailinfo.bestbuy.com", auth: PASS,
    subject: "Apple AirPods deals end Sunday", body: "Save on Apple AirPods this week only. Shop now.",
    links: [{ text: "Shop now", href: "https://emailinfo.bestbuy.com/c/abc" }] } },
  { name: "real Amazon shipping notice", m: { fromName: "Amazon.com", from: "shipment-tracking@amazon.com", auth: PASS,
    subject: "Your Amazon.com order has shipped", body: "Your package with slippers is on the way. Track your package.",
    links: [{ text: "Track package", href: "https://www.amazon.com/gp/your-account/ship-track?id=1" }, { text: "amazon.com", href: "https://www.amazon.com/" }] } },
  { name: "friend writing normally", m: { fromName: "Margaret Lee", from: "margaret.lee@example-mail.test", auth: PASS,
    subject: "Lunch on Thursday?", body: "Hi Linda, are you free for lunch on Thursday? The usual place at noon.", links: [] } },
  { name: "pharmacy reminder", m: { fromName: "CVS Pharmacy", from: "CVS@pharmacy-cvs.com", auth: PASS,
    subject: "Your prescription is ready", body: "Your prescription is ready for pickup at your CVS on Main Street.",
    links: [{ text: "Manage prescriptions", href: "https://www.cvs.com/account" }] } },
  { name: "Meetup with 'ups' inside a word", m: { fromName: "Meetup", from: "info@meetup.com", auth: PASS,
    subject: "New events in your groups: Startups & signups", body: "3 new events from your groups this week.",
    links: [{ text: "See events", href: "https://www.meetup.com/home" }] } },
  { name: "a plumber's real invoice sent through Xero", m: { fromName: "Bob's Plumbing", from: "messaging-service@post.xero.com", replyTo: "bob@bobsplumbing.test", auth: PASS,
    subject: "Invoice INV-0042 from Bob's Plumbing for Linda", body: "Hi Linda, here's invoice INV-0042 for $240.00. View your bill online: https://in.xero.com/AbCdEf. Thanks, Bob",
    links: [{ text: "View bill", href: "https://in.xero.com/AbCdEf" }] } },
  { name: "a real Adecco job alert from adecco.com", m: { fromName: "Adecco", from: "jobs@adecco.com", auth: PASS,
    subject: "New jobs matching your profile", body: "Three new jobs near you match your profile.",
    links: [{ text: "See the jobs", href: "https://www.adecco.com/en-us/jobs" }] } },
  { name: "a friend called Edward Norton sharing photos", m: { fromName: "Edward Norton", from: "ed.norton@example-mail.test", auth: PASS,
    subject: "Photos from Sunday", body: "Here are the photos from Sunday lunch!", links: [{ text: "Album", href: "https://photos.example.test/album/42" }] } },
  { name: "a newspaper renewal notice with a phone number", m: { fromName: "The Boston Globe", from: "billing@globe.com", auth: PASS,
    subject: "Your subscription renews soon", body: "Your subscription renews on November 1 for $29.99. To cancel, call 1-888-694-5623.", links: [] } },
  { name: "a genuine Google Calendar invitation", m: { fromName: "Margaret Lee", from: "calendar-notification@google.com", auth: PASS,
    subject: "Invitation: Lunch @ Thu Nov 5, 12pm", body: "Margaret Lee has invited you to Lunch. Join with Google Meet.",
    links: [{ text: "Join with Google Meet", href: "https://meet.google.com/abc-defg-hij" }, { text: "Yes", href: "https://calendar.google.com/calendar/event?action=RESPOND" }] } },
  // Codex red-team false positives (2026-10-26): mentions are not asks.
  { name: "gift card receipt", m: { fromName: "Oak Street Books", from: "receipts@bookshop.test", auth: PASS, subject: "Gift card receipt", body: "Thank you for purchasing a $50 gift card for your granddaughter.", links: [] } },
  { name: "invoice paid by ordinary bank transfer", m: { fromName: "Atelier Martin", from: "billing@plombier.test", auth: PASS, subject: "Facture réparation", body: "Merci pour votre confiance. Règlement par virement sur le compte figurant sur votre facture.", links: [] } },
  { name: "a sign-in code being sent to you", m: { fromName: "Community centre", from: "login@community.test", auth: PASS, subject: "Sign-in code", body: "Your verification code is 483921. It expires in ten minutes.", links: [] } },
  { name: "a talk about bitcoin risks", m: { fromName: "Town Library", from: "news@library.test", auth: PASS, subject: "Free lecture", body: "Join our talk about bitcoin and cryptocurrency risks on Thursday.", links: [] } },
  { name: "a gift card ready in store", m: { fromName: "Librairie du marché", from: "shop@marche.test", auth: PASS, subject: "Votre commande", body: "Votre carte cadeau de 30 euros est prête à retirer en boutique.", links: [] } },
  { name: "a promo offering a gift card", m: { fromName: "Shop", from: "promo@shop.test", auth: PASS, subject: "Holiday deal", body: "Get a $10 gift card when you spend $50! Enter promo codes at checkout.", links: [] } },
  // Live inbox, 2026-10-28: newsletters our link rules misread (anonymised).
  { name: "Zillow alert whose plain-text link is the company's own tracker", safe: true, m: { fromName: "Zillow", from: "instant-updates@mail.zillow.com", auth: PASS,
    subject: "A Somerville home for you: 37 Elm St", body: "New listing. View it: https://click.mail.zillow.com/ls/click?upn=abc&url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1",
    links: [{ text: "https://click.mail.zillow.com/ls/click?upn=abc&url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1", href: "https://click.mail.zillow.com/ls/click?upn=abc&url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1" }] } },
  { name: "Amex offers whose buttons name shops but go through Amex's tracker", safe: true, m: { fromName: "American Express", from: "AmericanExpress@member.americanexpress.com", auth: PASS,
    subject: "New Amex Offers for you", body: "Earn a statement credit at these shops.",
    links: [{ text: "lululemon.com", href: "https://click.member.americanexpress.com/?qs=abc" }, { text: "ouraring.com", href: "https://click.member.americanexpress.com/?qs=def" }] } },
  { name: "Apple newsletter linking to YouTube", safe: true, m: { fromName: "Apple", from: "News@insideapple.apple.com", auth: PASS,
    subject: "Watch the keynote", body: "Catch up on everything announced.",
    links: [{ text: "Watch on YouTube", href: "https://www.youtube.com/watch?v=abc" }, { text: "Bilibili", href: "https://space.bilibili.com/123" }] } },
  { name: "an event invite whose calendar button goes through the sender's tracker", safe: true, m: { fromName: "Frenchfounders", from: "events@frenchfounders.com", auth: PASS,
    subject: "Founders dinner in Boston", body: "Book a slot with our team.",
    links: [{ text: "https://calendar.app.google/tqUW", href: "https://email.frenchfounders.com/c/abc" }] } },
  { name: "a link carrying a template placeholder instead of a website", m: { fromName: "Snowball", from: "news@media.snowball.xyz", auth: PASS,
    subject: "Your weekly summary", body: "See your portfolio: https://redirect.media-snowball.com/r?url=https://media.__snowball__/x",
    links: [{ text: "https://redirect.media-snowball.com/r?url=https://media.__snowball__/x", href: "https://redirect.media-snowball.com/r?url=https://media.__snowball__/x" }] } },
  { name: "French newsletter", m: { fromName: "Fnac", from: "newsletter@fnac.com", auth: PASS,
    subject: "Les nouveautés de la semaine", body: "Découvrez nos nouveautés livres et musique. Livraison gratuite en magasin.",
    links: [{ text: "Découvrir", href: "https://click.fnac.com/abc" }] } },
];

for (const { name, m, safe } of LEGIT) {
  test(`legit: ${name} is never Scam${safe ? " (Safe)" : ""}`, () => {
    const v = run(m);
    assert.notEqual(v.verdict, "scam", `${name}: ${v.reasons.map((r) => r.text).join(" | ")}`);
    if (safe) assert.equal(v.verdict, "safe", `${name}: ${v.reasons.map((r) => r.text).join(" | ")}`);
  });
}

test("scam: an authenticated look-alike sender showing a protected brand's address on its own link is still caught", () => {
  const v = run({ fromName: "Account Security", from: "alerts@secure-login-center.test", auth: PASS,
    subject: "Your account is locked", body: "Your Chase account is locked. Sign in now to restore access.",
    links: [{ text: "chase.com", href: "https://secure-login-center.test/signin" }] });
  assert.equal(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
});

test("legit: a genuine Société Générale secure-message notice stays Safe (same wording as the A7 scam)", async () => {
  const { readFile } = await import("node:fs/promises");
  const cards = JSON.parse(await readFile(new URL("../data/patterns/cards.json", import.meta.url), "utf8"));
  const sgCtx = { ...emptyContext("Françoise"), providers: [{ type: "bank", name: "Société Générale", realDomains: ["societegenerale.fr", "sg.fr"] }] };
  const v = detect({ locale: "fr-FR", personalContext: sgCtx, patternCards: cards, message: { channel: "email", fromName: "Société Générale",
    from: "messagerie@societegenerale.fr", auth: PASS, subject: "Nouveau message dans votre messagerie sécurisée",
    body: "Bonjour, vous avez 1 nouveau message dans votre messagerie sécurisée. Connectez-vous à votre Espace Client pour le consulter.",
    links: [{ text: "Accéder à mon Espace Client", href: "https://particuliers.sg.fr/icd/cbo/index-authsec.html" }] } });
  assert.equal(v.verdict, "safe", v.reasons.map((r) => r.text).join(" | "));
});

test("legit: a plumber's real Xero invoice stays Safe (replies to the business are normal)", () => {
  assert.equal(run(LEGIT.find((l) => l.name.includes("Xero")).m).verdict, "safe");
});

test("legit: an advert naming another brand stays Safe, not just not-Scam", () => {
  assert.equal(run(LEGIT[3].m).verdict, "safe");
});

const SCAMS = [
  { name: "display-name spoof of a bank with a look-alike link", m: { fromName: "Chase Bank", from: "secure@chase-alerts-verify.top", auth: "spf=pass dkim=none dmarc=none",
    subject: "Unusual sign-in attempt", body: "We detected unusual activity. Confirm your password within 24 hours or your account will be locked.",
    links: [{ text: "chase.com", href: "https://chase-alerts-verify.top/login" }] } },
  { name: "USPS redelivery fee by text, no claimedBrand", m: { channel: "sms", fromName: "", from: "+1 555-0199",
    body: "USPS: Your package is on hold due to an incomplete address. Pay $1.99 here: https://usps-redeliver.top/pay",
    links: [{ text: "https://usps-redeliver.top/pay", href: "https://usps-redeliver.top/pay" }] } },
  { name: "unauthenticated mail claiming Amazon in the subject", m: { fromName: "Customer Service", from: "support@amaz0n-billing.top", auth: "spf=fail dkim=none dmarc=fail",
    subject: "Your Amazon account is suspended", body: "Your Amazon account is suspended. Update your card details immediately to avoid fees.",
    links: [{ text: "Update now", href: "https://amaz0n-billing.top/update" }] } },
  { name: "gift-card request from an unknown sender", m: { fromName: "Pastor John", from: "pastor.john.office@freemail.test", auth: PASS,
    subject: "Quick favor", body: "I need you to buy 4 Apple gift cards of $100 for the church today. Keep it between us, send me the codes.", links: [] } },
  { name: "gift cards asked for and their codes", m: { fromName: "Pastor John", from: "pastor.john.office@freemail.test", auth: PASS, subject: "Quick favor", body: "Please pick up three Google Play gift cards today and text me pictures of the numbers on the back.", links: [] } },
  { name: "a code you received asked back", m: { channel: "sms", fromName: "", from: "+33 6 12 34 56 78", body: "Mamie, je t'ai envoyé un code par erreur, peux-tu me le renvoyer ? C'est le code que tu viens de recevoir.", links: [] } },
  { name: "a transfer to a new safe account", m: { fromName: "Service fraude", from: "conseiller@banque-securite.test", auth: "spf=none dkim=none dmarc=none", subject: "Urgent", body: "Votre compte est piraté. Faites un virement immédiat vers votre nouveau compte sécurisé.", links: [] } },
  // Found by the Codex red-team review (2026-10-26).
  { name: "callback invoice: surprise Geek Squad renewal with a number to call", m: { fromName: "Renewal Team", from: "billing@support-ledger.test", auth: PASS,
    subject: "Your Geek Squad renewal", body: "Your annual plan renewed for $389.99. For cancellation call 202-555-0148.", links: [] } },
  { name: "real PayPal invoice email carrying a scammer's callback number", m: { fromName: "PayPal", from: "service@paypal.com", auth: PASS,
    subject: "Invoice from Help Desk", body: "You owe $499 for annual protection. To cancel call 202-555-0148.",
    links: [{ text: "View invoice", href: "https://www.paypal.com/invoice/p/EXAMPLE" }] } },
  { name: "display name with an invisible character inside PayPal", m: { fromName: "P\u200bayPal", from: "noreply@account-support.test", auth: PASS,
    subject: "Account review", body: "Review your account at https://account-support.test", links: [{ text: "https://account-support.test", href: "https://account-support.test" }] } },
];

for (const { name, m } of SCAMS) {
  test(`scam: ${name} is caught`, () => {
    const v = run(m);
    assert.equal(v.verdict, "scam", `${name}: got ${v.verdict} — ${v.reasons.map((r) => r.text).join(" | ")}`);
  });
}

test("a text from a phone number is never described as a website address", () => {
  const v = run({ channel: "sms", fromName: "", from: "5551234",
    body: "USPS: Your package is on hold. Pay $1.99 today: https://usps-redeliver.top/pay",
    links: [{ text: "https://usps-redeliver.top/pay", href: "https://usps-redeliver.top/pay" }] });
  assert.equal(v.verdict, "scam");
  assert.ok(!v.reasons.some((r) => /website address is [\d.]+/.test(r.text)), v.reasons.map((r) => r.text).join(" | "));
});

// Codex red-team review, round 2 (2026-10-26): lures that need no brand.
const L = (b) => [...b.matchAll(/https?:\/\/\S+/g)].map((x) => ({ text: x[0], href: x[0] }));
const RED_TEAM = [
  ["toll text with a payment link", "en-US", { channel: "sms", from: "+12025550148", body: "Road services: Your toll balance is $6.40. Settle at https://road-balance.test" }],
  ["CPF rights 'expiring tonight'", "fr-FR", { channel: "sms", from: "+33612345678", body: "Votre dossier CPF expire ce soir. Retrouvez vos droits sur https://droits-formation.test" }],
  ["EDF refund asking for details", "fr-FR", { fromName: "Service énergie", from: "contact@regul-energie.test", auth: PASS, subject: "EDF remboursement", body: "Un avoir de 148 euros vous attend. Complétez votre dossier sur https://regul-energie.test" }],
  ["'Bonjour Mamie' broken phone, pay the repairer", "fr-FR", { channel: "whatsapp", from: "+33612345678", body: "Bonjour Mamie, mon téléphone est cassé. Peux-tu régler 890 euros au réparateur ? Je te rembourse demain." }],
  ["web-page attachment posing as a voicemail", "en-US", { fromName: "Microsoft 365", from: "voicemail@vm-notify.test", auth: PASS, subject: "New voicemail", body: "You have a new voicemail. Open the attached file to listen.", attachments: [{ filename: "voicemail.html", mimeType: "text/html" }] }],
  ["Medicare member number through a link", "en-US", { fromName: "Member services", from: "notice@verify-benefit.test", auth: PASS, subject: "Coverage update", body: "Medicare requires your member number to retain coverage. Submit it at https://verify-benefit.test" }],
  ["link asking an app to read the mailbox", "en-US", { fromName: "Photo share", from: "family@photo-share.test", auth: PASS, subject: "Family album", body: "View our reunion photos and approve Album Helper to read your mailbox.",
    links: [{ text: "View album", href: "https://accounts.google.com/o/oauth2/v2/auth?client_id=example&scope=https://mail.google.com/" }] }],
];
for (const [name, locale, m] of RED_TEAM) {
  test(`scam: ${name} is caught`, () => {
    const v = detect({ locale, personalContext: ctx, message: { channel: "email", subject: "", fromName: "", auth: "", ...m, links: m.links || L(m.body) } });
    assert.equal(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
  });
}

test("a 'scan this code' statement is at least Be careful (a QR code hides its address)", () => {
  const v = run({ fromName: "Document service", from: "notice@shared-doc.test", auth: PASS, subject: "Your pension statement",
    body: "Your statement is attached. Scan the square image to review your pension details.", links: [], attachments: [{ filename: "pension.pdf", mimeType: "application/pdf" }] });
  assert.notEqual(v.verdict, "safe");
});

test("a known contact's real address sending a link to a 3-day-old site is Be careful, not Safe", () => {
  const withEthan = { ...ctx, trustedContacts: [{ name: "Ethan", email: "ethan@example-mail.test", relation: "grandson" }] };
  const message = { channel: "email", fromName: "Ethan", from: "ethan@example-mail.test", auth: PASS, subject: "look at this",
    body: "Grandma look at this photo of us https://photos-share.top/x", links: [{ text: "https://photos-share.top/x", href: "https://photos-share.top/x" }] };
  const v = detect({ locale: "en-US", personalContext: withEthan, message, mockLinkInspection: { "https://photos-share.top/x": { domain_age_days: 3 } } });
  assert.equal(v.verdict, "be_careful");
  assert.equal(v._authentic, false, "a possibly hacked contact never shields the AI's verdict");
  assert.equal(detect({ locale: "en-US", personalContext: withEthan, message: { ...message, body: "See you Sunday Grandma!", links: [] } }).verdict, "safe");
});

const LOOKALIKE_LEGIT = [
  ["a family text about Sunday lunch", "fr-FR", { channel: "sms", from: "+33600000000", body: "Mamie, on arrive dimanche à midi, bisous" }],
  ["a refund already issued", "en-US", { fromName: "Amazon.com", from: "returns@amazon.com", auth: PASS, subject: "Your refund", body: "Your refund of $45.00 has been issued to your original payment method.", links: [] }],
  ["a real toll statement by authenticated email", "en-US", { fromName: "SunPass", from: "statements@sunpass.com", auth: PASS, subject: "Your toll statement", body: "Your toll invoice of $12.40 is ready. View it at https://www.sunpass.com/account" }],
  ["a PDF invoice from a tradesman", "fr-FR", { fromName: "Atelier Martin", from: "billing@plombier.test", auth: PASS, subject: "Facture", body: "Veuillez trouver votre facture en pièce jointe.", attachments: [{ filename: "facture-042.pdf", mimeType: "application/pdf" }], links: [] }],
  ["a calendar invitation file", "en-US", { fromName: "Margaret Lee", from: "margaret.lee@example-mail.test", auth: PASS, subject: "Lunch", body: "See invite attached.", attachments: [{ filename: "invite.ics", mimeType: "text/calendar" }], links: [] }],
];
for (const [name, locale, m] of LOOKALIKE_LEGIT) {
  test(`legit: ${name} stays Safe`, () => {
    const v = detect({ locale, personalContext: ctx, message: { channel: "email", subject: "", fromName: "", auth: "", ...m, links: m.links || L(m.body) } });
    assert.equal(v.verdict, "safe", v.reasons.map((r) => r.text).join(" | "));
  });
}

// Public-corpus findings (Zenodo 8339691, 2026-10-26): whole scam families
// the rules did not know, and genuine look-alikes that must stay Safe.
test("scam: an advance-fee ('419') proposal is caught", () => {
  const v = run({ fromName: "Barrister James Okoro", from: "jokoro.chambers@freemail.test", auth: "", subject: "URGENT BUSINESS PROPOSAL",
    body: "I am the attorney to the late Mr. Williams who died with his family. He left US$12,500,000 in a dormant account and I need a foreign partner as next of kin. Please send your full name, address and telephone number so we can release the funds. You will receive 30% for your assistance. This is strictly confidential.", links: [] });
  assert.equal(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
});
test("scam: a fake 'mailbox full' warning is caught without any brand", () => {
  const v = run({ fromName: "Mail Administrator", from: "admin@kommune-mail.test", auth: "", subject: "Mailbox Warning!!!",
    body: "Your mailbox has exceeded its storage limit and will be suspended within 24 hours. Click here to validate your e-mail account and restore full access.", links: [] });
  assert.equal(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
});
for (const [name, m] of [
  ["a sign-up 'verify your email' with no threat", { fromName: "Garden Forum", from: "hello@gardenforum.test", auth: PASS, subject: "Please verify your email", body: "Welcome! Please verify your email address by clicking the link below.", links: [{ text: "Verify", href: "https://gardenforum.test/verify?t=1" }] }],
  ["football news about a transfer fee", { fromName: "Sports Daily", from: "news@sportsdaily.test", auth: PASS, subject: "Transfer news", body: "The club confirmed a transfer fee of €80 million for the striker, the director of football said in a confidential briefing.", links: [] }],
  ["a concert ticket from Live Nation", { fromName: "Live Nation", from: "tickets@livenation.test", auth: PASS, subject: "Your tickets", body: "Your tickets are ready.", links: [{ text: "View tickets", href: "https://livenation.test/t" }] }],
  ["a newsletter linking apple.slashdot.org", { fromName: "Slashdot", from: "newsletter@slashdot.org", auth: PASS, subject: "Stories for today", body: "Apple releases a new update.", links: [{ text: "Read", href: "https://apple.slashdot.org/story/1" }] }],
  ["developers discussing 'send the code'", { fromName: "Dev List", from: "dev@lists.example.test", auth: PASS, subject: "Re: patch", body: "Can you send the code you wrote for the parser? I will review it tomorrow.", links: [] }],
]) {
  test(`legit: ${name} is never Scam`, () => assert.notEqual(run(m).verdict, "scam", run(m).reasons.map((r) => r.text).join(" | ")));
}

test("authenticated brand mail that fits history is marked _authentic for the model guardrail", () => {
  const amazonCtx = { ...ctx, providers: [{ type: "retail", name: "Amazon", realDomains: ["amazon.com"] }] };
  const v = run(LEGIT[4].m, amazonCtx);
  assert.equal(v.verdict, "safe");
  assert.equal(v._authentic, true);
});

// /codex plan challenge (2026-10-29): for someone who really uses PayPal,
// an authenticated PayPal invoice carrying a callback number or a money ask
// must not count as "authentic history", or the guardrail would cap Muse
// Spark's Scam at Be careful. Authentication proves who carried it, not
// that the request inside is legitimate.
test("a real PayPal user's PayPal invoice with a callback number is not 'authentic'", () => {
  const withPaypal = { ...ctx, providers: [{ type: "payment", name: "PayPal", realDomains: ["paypal.com"] }],
    knownSenders: [{ name: "PayPal", email: "service@paypal.com", brand: "PayPal" }] };
  const v = run({ fromName: "PayPal", from: "service@paypal.com", auth: PASS, subject: "Invoice from Help Desk",
    body: "You owe $499 for annual protection. To cancel call 202-555-0148.",
    links: [{ text: "View invoice", href: "https://www.paypal.com/invoice/p/EXAMPLE" }] }, withPaypal);
  assert.equal(v._authentic, false, v.reasons.map((r) => r.text).join(" | "));
  assert.notEqual(v.verdict, "safe");
  const receipt = run({ fromName: "PayPal", from: "service@paypal.com", auth: PASS, subject: "Receipt for your payment to Etsy",
    body: "You sent a payment of $24.00 USD to Etsy. View the details in your account.",
    links: [{ text: "View details", href: "https://www.paypal.com/myaccount/transactions" }] }, withPaypal);
  assert.equal(receipt._authentic, true, "a plain receipt from a provider she uses stays authentic");
  assert.equal(receipt.verdict, "safe");
});

// Oct 29, Hadrien's inbox: real newsletters flagged by the rules while
// Muse Spark said Safe (the guardrail then forced Be careful).
const SENDGRID_BUTTON = { fromName: "Joanne Domeniconi", from: "hello@joannedomeniconi.com", auth: PASS, subject: "This week's workshop",
  body: "New dates for the spring workshop are up. See you there!",
  links: [{ text: "joannedomeniconi.com", href: "https://u111538503.ct.sendgrid.net/ls/click?upn=abc123" }] };

test("legit: a button showing the sender's own site through its email service's tracker (SendGrid) is not a disguise", () => {
  const v = run(SENDGRID_BUTTON);
  assert.notEqual(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
  assert.ok(!v.reasons.some((r) => /really leads to/.test(r.text)), v.reasons.map((r) => r.text).join(" | "));
});

test("the email-service exemption needs the sender's own site, authenticated", () => {
  const brandText = run({ ...SENDGRID_BUTTON, body: "Your PayPal account is limited. Log in to restore it.", links: [{ text: "paypal.com", href: "https://u1.ct.sendgrid.net/ls/click?upn=x" }] });
  assert.equal(brandText.verdict, "scam", "showing someone else's site through the tracker is still a disguise");
  const unauth = run({ ...SENDGRID_BUTTON, auth: "spf=fail dkim=none dmarc=fail" });
  assert.ok(unauth.reasons.some((r) => /really leads to/.test(r.text)), "an unproven sender gets no exemption");
});

test("a pasted address that openly passes through a redirect is said, not called a disguise (Snowball)", () => {
  const v = run({ fromName: "Snowball", from: "newsletter@media.snowball.xyz", replyTo: "hello@snowball.xyz", auth: PASS, subject: "Weekly market notes",
    body: "Read the annual report: https://redirect.media-snowball.com/?url=https%3A%2F%2Fs206.q4cdn.com%2Freport.pdf",
    links: [{ text: "https://redirect.media-snowball.com/?url=https%3A%2F%2Fs206.q4cdn.com%2Freport.pdf", href: "https://redirect.media-snowball.com/?url=https%3A%2F%2Fs206.q4cdn.com%2Freport.pdf" }] });
  assert.notEqual(v.verdict, "scam", v.reasons.map((r) => r.text).join(" | "));
});

test("a sender the person kept is not called a scam on soft signs, but hard evidence still counts", () => {
  const kept = { ...ctx, knownSenders: [{ name: "Joanne", email: "hello@joannedomeniconi.com", brand: null, confirmedByUser: true }] };
  const odd = { ...SENDGRID_BUTTON, links: [{ text: "joannedomeniconi.com", href: "https://workshops.example-cdn.test/spring" }] };
  assert.notEqual(run(odd, kept).verdict, "scam", "a kept sender's odd-looking link alone is not a scam");
  assert.equal(run(odd).verdict, "scam", "without the keep, the same message is still caught");
  const hacked = { ...odd, body: "Urgent: confirm your bank details to keep your place. Enter your card number here.", links: [{ text: "joannedomeniconi.com", href: "https://joanne-pay.example-new.test/card" }] };
  assert.equal(run(hacked, kept).verdict, "scam", "a kept sender asking for card details is still a scam (hacked mailbox)");
  const spoofed = run(odd, { ...kept });
  assert.ok(spoofed);
  const unauth = run({ ...odd, auth: "spf=fail dkim=none dmarc=fail" }, kept);
  assert.equal(unauth.verdict, "scam", "the keep counts only when Gmail proves the address");
});
