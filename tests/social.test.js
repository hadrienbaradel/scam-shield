// Conversations and new friends (_product/specs/messenger-channel.md, lines
// 3 to 6 and 15): a chat is judged as a whole, the stranger's opener is Be
// careful, the never-asks are Scam whatever else is said, the prompt never
// calls a photo fake, and a chat pasted in Check something reaches the model
// as a conversation. Mock LLM, no network; the one HTTP test needs Postgres
// and skips itself without it.
import "./helpers/env.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getProvider } from "../lib/llm/index.js";
import { checkMessage, systemPrompt, breaker, PROMPT_VERSION } from "../lib/muse.js";
import { detect } from "../lib/detector.js";
import { splitTurns, conversationInput } from "../lib/conversation.js";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const linda = await load("data/profiles/linda.json");
const francoise = await load("data/profiles/francoise.json");
const mock = getProvider("mock");
const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const dbOpts = { skip: hasDb ? false : "Postgres test database not available" };
let app;

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });
afterEach(() => { delete process.env.LLM_PROVIDER; mock.reset(); breaker.failures = 0; breaker.openUntil = 0; });

// Daniel's six turns: a wrong-number opener, a move to WhatsApp, profits
// shown, then the first deposit.
const CHAT = [
  "Daniel: Hello, is this Mary? Sorry, wrong number!",
  "Me: No problem, I am Linda.",
  "Daniel: You seem kind. Let's talk on WhatsApp, it is easier.",
  "Me: OK, why not.",
  "Daniel: My uncle's app made me $8,400 this month, look at my profits.",
  "Daniel: It is easy. Start with $500 on my mentor's app, I will guide you.",
].join("\n");
const modelVerdict = {
  verdict: "scam", confidence: 0.95, headline: "Scam: this is the 'new friend, then investment' trick.",
  reasons: [{ text: "He wrote to you first, moved the talk to WhatsApp and now shows you his profits.", evidence: "thread" },
    { text: "Next he will ask you to put money on his app, then for a fee to take it out.", evidence: "pattern" }],
  action: "ask_guardian", action_text: "Send nothing. Show this to someone you trust.", real_company_says: null, impersonated_brand: null,
  scam_type: "romance_investment", matched_pattern_ids: [], escalate_to_guardian: true,
  guardian_summary: "A stranger is running a pig-butchering scam on Linda: first deposit asked.", language: "en",
};
const blockOf = (prompt, tag) => JSON.parse(prompt.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"))[1]);
const sms = (body, extra = {}) => ({ channel: "sms", from: "+1 555-0170", fromName: "+1 555-0170", subject: "", body, links: [], ...extra });
const rules = (message, { locale = "en-US", ctx = linda, threadHistory = [] } = {}) =>
  detect({ locale, message, personalContext: ctx, patternCards: [], threadHistory });

test("a six-turn chat reaches Muse Spark as thread history, and the system prompt names the scam paths and what usually comes next", async () => {
  process.env.LLM_PROVIDER = "mock";
  mock.script(modelVerdict);
  const chat = conversationInput(splitTurns(CHAT));
  const v = await checkMessage({ locale: "en-US", message: { ...chat.message, links: [] }, threadHistory: chat.threadHistory, personalContext: linda, patternCards: [] });
  assert.equal(mock.calls.length, 1);
  const sent = mock.calls[0].messages[0].content;
  const history = blockOf(sent, "thread_history");
  assert.deepEqual(history.map((m) => m.from), ["Daniel", "you", "Daniel", "you", "Daniel"]);
  assert.match(history[0].body, /is this Mary\? Sorry, wrong number/);
  assert.equal(blockOf(sent, "message").body, "It is easy. Start with $500 on my mentor's app, I will guide you.");
  assert.equal(blockOf(sent, "message").from_name, "Daniel");
  // The rules saw the whole path too, and tell the model where it stands.
  const evidence = blockOf(sent, "detector_evidence");
  assert.equal(evidence.preliminary_verdict, "scam");
  assert.ok(evidence.findings.some((f) => /wrote to you first, moved the talk to another app/.test(f.fact)), JSON.stringify(evidence.findings));
  const system = mock.calls[0].system;
  assert.match(system, /## Conversations and new friends/);
  assert.match(system, /never on its last message alone/);
  for (const path of [/friendly opener, then investment talk \("pig butchering"\)/, /A romance, then money/, /A wrong number that keeps chatting/, /A job that pays to click/]) assert.match(system, path);
  assert.match(system, /what usually comes next/);
  assert.match(system, /a fee or a tax to withdraw; the recovery offer/);
  assert.equal(v.verdict, "scam");
  assert.deepEqual(v.reasons.map((r) => r.evidence), ["thread", "pattern"]);
});

test("a chat pasted in Check something is judged as one conversation, with nothing more stored", dbOpts, async () => {
  process.env.LLM_PROVIDER = "mock";
  mock.script(modelVerdict);
  const user = await makeUser({ email: "linda.social@example.test", name: "Linda" });
  const res = await app.inject({ method: "POST", url: "/api/check/text", headers: { cookie: await sessionFor(user), origin: ORIGIN },
    payload: { channel: "sms", body: CHAT } });
  assert.equal(res.statusCode, 200, res.body);
  const out = res.json();
  assert.deepEqual(Object.keys(out).sort(), ["callBack", "checkId", "message", "verdict"]);
  assert.equal(out.verdict.verdict, "scam");
  assert.equal(out.message.channel, "social");
  assert.equal(out.message.body, CHAT, "the answer carries the whole conversation for Ask my trusted person");
  assert.ok(!("fullText" in out.message));
  const sent = mock.calls[0].messages[0].content;
  assert.equal(blockOf(sent, "thread_history").length, 5);
  assert.match(blockOf(sent, "message").body, /^It is easy\. Start with \$500/);
  const row = await one("SELECT * FROM checks WHERE id = $1", [out.checkId]);
  assert.equal(row.channel, "pasted");
  for (const words of ["wrong number", "8,400", "mentor's app"]) assert.ok(!JSON.stringify(row).includes(words), `the chat is never stored: ${words}`);
});

test("a stranger's wrong-number opener and compliment opener are Be careful from the rules alone; a plain hello from a trusted contact is not", async () => {
  const wrongNumber = await checkMessage({ locale: "en-US", message: sms("Hi, is this Mary? It's Jessica from the garden club."), personalContext: linda, patternCards: [] });
  assert.match(wrongNumber.source, /^detector/, "no model: the rules answer");
  const compliment = rules(sms("Hello handsome, I saw your profile and you look so kind. Can we be friends?"));
  const french = rules(sms("Bonjour, c'est bien Martine ? Je crois que je me suis trompée de numéro."), { locale: "fr-FR", ctx: francoise });
  for (const v of [wrongNumber, compliment]) {
    assert.equal(v.verdict, "be_careful", v.reasons.map((r) => r.text).join(" | "));
    assert.equal(v.action_text, "Do not answer. This is how romance and investment scams start.");
    assert.match(v.reasons[0].text, /out of the blue/);
  }
  assert.equal(french.verdict, "be_careful");
  assert.equal(french.action_text, "Ne répondez pas. C'est ainsi que commencent les arnaques sentimentales et à l'investissement.");
  const ethan = { from: "+1 555-0142", fromName: "Ethan Miller" };
  for (const body of ["Hi Grandma, how are you?", "Hi beautiful, how are you today?"]) {
    assert.equal(rules(sms(body, ethan)).verdict, "safe", `from Ethan's saved number: ${body}`);
  }
  assert.notEqual(rules({ channel: "email", from: "news@garden.example.test", fromName: "Garden Club", subject: "Hello beautiful people", body: "Hi dear members, the show is on Saturday.", links: [] }).verdict,
    "be_careful", "an email is not a stranger's opener");
});

test("money on a trading app, a fee to withdraw, an app from outside the stores and a command to paste are Scam from the rules alone", () => {
  const deposit = rules(sms("My mentor's trading platform made me $8,400 this month. Start with $500 on the app, I will guide you."));
  assert.equal(deposit.verdict, "scam");
  assert.equal(deposit.scam_type, "romance_investment");
  assert.equal(deposit.action, "ask_guardian");
  assert.equal(deposit.action_text, "Send nothing. Show this to someone you trust.");
  assert.equal(deposit.headline, "Scam: this is the 'new friend, then investment' trick.");
  assert.ok(deposit.reasons.some((r) => r.evidence === "pattern" && /^Next they will ask for more money/.test(r.text)), "what usually comes next");

  const fee = rules(sms("Congratulations, your profit is $12,400. To withdraw it you must first pay a 15% tax."));
  const feeFr = rules(sms("Pour retirer vos gains, vous devez d'abord payer une taxe de 15 %."), { locale: "fr-FR", ctx: francoise });
  const apk = rules(sms("Here is our app, it is not on the App Store: https://app-download.test/install.apk",
    { links: [{ text: "https://app-download.test/install.apk", href: "https://app-download.test/install.apk" }] }));
  const profile = rules(sms("Open itms-services://?action=download-manifest&url=https://app-download.test/m.plist to get the app."));
  const command = rules(sms("To prove you are human, press Win+R, paste the code and press Enter."));
  const terminal = rules({ channel: "email", from: "hr@recruit.example.test", fromName: "Recruiting", subject: "Your interview", body: "Before the call, open Terminal and paste this command to install our meeting tool.", links: [] });
  for (const [name, v] of Object.entries({ fee, feeFr, apk, profile, command, terminal })) {
    assert.equal(v.verdict, "scam", `${name}: ${v.reasons.map((r) => r.text).join(" | ")}`);
  }
  assert.match(fee.reasons[0].text, /pay a fee or a tax before you can take out your own money/);
  assert.equal(fee.headline, "Scam: never pay a fee to get your own money.");
  assert.match(apk.reasons.map((r) => r.text).join(" "), /install an app from a link instead of the official app store/);
  assert.match(command.reasons[0].text, /paste or type a command/);
});

test("in a conversation, the path and the next move are said, and the first deposit is Scam even after weeks of friendly talk", () => {
  // The chat pasted as one block of text counts as a conversation too.
  const scam = rules(sms(CHAT));
  assert.equal(scam.verdict, "scam");
  assert.deepEqual(scam.reasons.map((r) => r.evidence), ["payment", "thread", "pattern"]);
  assert.equal(scam.reasons[1].text, "They wrote to you first, moved the talk to another app and now ask for money for an investment. That is a known scam.");
  const talkOnly = rules(sms(["Daniel: Hello, is this Mary?", "Me: No, sorry.", "Daniel: You seem kind. My uncle's app made me $8,400 this month, look at my profits."].join("\n")));
  assert.equal(talkOnly.verdict, "be_careful", "no ask yet: where it is heading");
  assert.equal(talkOnly.headline, "Be careful: this is how investment scams start.");
  assert.equal(talkOnly.reasons[0].text, "They wrote to you first and now talk about investing. That is how investment scams start.");
  assert.equal(talkOnly.reasons[1].text, "Next they will ask you to put money on their app, then for a fee to take it out.");
  const friend = rules(sms("See you Sunday at noon, and bring the photos from the trip!", { from: "+1 555-0188", fromName: "Carol" }), { threadHistory: [
    { from: "Carol", body: "Lovely to see you at church today, Linda!" }, { from: "you", body: "You too! Are we still on for lunch?" },
    { from: "Carol", body: "Yes, at my place. I will make the lemon cake." }] });
  assert.equal(friend.verdict, "safe");
});

// What /api/check/text hands the engine for a pasted chat.
const pasted = (words, selfNames = []) => {
  const chat = conversationInput(splitTurns(words, { selfNames }));
  return { message: { ...chat.message, links: [], auth: "", fullText: words }, threadHistory: chat.threadHistory };
};

test("an ask hidden in an earlier turn of a chat is still Scam from the rules alone", async () => {
  // Messages forwarded one by one (the Messenger burst): the ask came first.
  const burst = await checkMessage({ locale: "en-US", personalContext: linda, patternCards: [],
    message: { channel: "messenger", from: "", fromName: "Daniel", subject: "", body: "Did you do it? I am waiting.", links: [] },
    threadHistory: [{ from: "Daniel", date: null, body: "Go to the store, buy 4 Apple gift cards and send me the codes on the back." },
      { from: "Daniel", date: null, body: "Hurry please." }] });
  assert.match(burst.source, /^detector/);
  assert.equal(burst.verdict, "scam", burst.reasons.map((r) => r.text).join(" | "));
  assert.match(burst.reasons.map((r) => r.text).join(" "), /gift cards/);
  // A link sent earlier in the chat is looked at like one in the last message.
  const link = detect({ locale: "en-US", personalContext: linda, patternCards: [],
    message: { channel: "sms", from: "+1 555-0170", fromName: "+1 555-0170", subject: "", body: "Did it work?", links: [] },
    threadHistory: [{ from: "them", body: "Your parcel is waiting, pay the fee here: https://parcel-hold.test/pay" }],
    mockLinkInspection: { "https://parcel-hold.test/pay": { final_url: "https://parcel-hold.test/pay", domain_age_days: 2 } } });
  assert.match(link.reasons.map((r) => r.text).join(" "), /created only 2 days before/);
  // An email thread keeps its history as context: earlier mail is not re-judged.
  const email = rules({ channel: "email", from: "ethan.miller@example-mail.test", fromName: "Ethan Miller", auth: "spf=pass dkim=pass", subject: "Re: lunch", body: "Sunday works, see you then.", links: [] },
    { threadHistory: [{ from: "x@example.test", body: "Buy 4 gift cards and send me the codes." }, { from: "y@example.test", body: "Lunch?" }] });
  assert.equal(email.verdict, "safe");
});

test("a chat whose scam line is labelled \"Me:\" or with the person's own name is still Scam from the rules alone", () => {
  const me = pasted("Daniel: Hello, how is your day?\nMe: To get your money back, press Win+R and paste the code I sent.\nDaniel: Did it work?");
  assert.equal(me.threadHistory[1].from, "you");
  const byMe = rules(me.message, { threadHistory: me.threadHistory });
  assert.equal(byMe.verdict, "scam", byMe.reasons.map((r) => r.text).join(" | "));
  assert.match(byMe.reasons[0].text, /paste or type a command/);
  // The person's own name, and a "Me:" line after the other person's last turn
  // (not in the thread history at all: only the whole pasted chat has it).
  const named = pasted("Daniel: Hi Linda\nLinda: You must first pay a 15% tax to withdraw your profits.\nDaniel: OK\nMe: Buy 4 gift cards and send the codes.", ["Linda"]);
  assert.equal(named.message.body, "OK");
  assert.ok(!named.threadHistory.some((m) => /gift cards/.test(m.body)));
  const byName = rules(named.message, { threadHistory: named.threadHistory });
  assert.equal(byName.verdict, "scam");
  const said = byName.reasons.map((r) => r.text).join(" ");
  assert.match(said, /pay a fee or a tax/);
  assert.match(said, /gift cards/);
});

test("the rules stay tight: a bank's transfer fee, a friend's new sofa and Apple's own TestFlight email are not never-asks", () => {
  const bank = rules({ channel: "email", from: "alerts@chase.com", fromName: "Chase", auth: "spf=pass dkim=pass dmarc=pass", subject: "Transfer sent",
    body: "Your transfer of $200 was sent. Your transfer fee is $3. You will pay a $2.50 fee to withdraw cash at other ATMs.", links: [] });
  const sofa = rules(sms("I invested in a new sofa, come and try it on Sunday!"));
  const testflight = rules({ channel: "email", from: "no_reply@email.apple.com", fromName: "TestFlight", auth: "spf=pass dkim=pass", subject: "You're invited to test",
    body: "Start testing: https://testflight.apple.com/join/abc", links: [{ text: "Start testing", href: "https://testflight.apple.com/join/abc" }] });
  for (const [name, v] of Object.entries({ bank, sofa, testflight })) assert.equal(v.verdict, "safe", `${name}: ${v.reasons.map((r) => r.text).join(" | ")}`);
  assert.equal(rules(sms("Join my beta on https://testflight.apple.com/join/xyz, it is not on the store yet.")).verdict, "scam", "TestFlight pushed by a stranger in a chat");
});

test("the system prompt forbids calling a photo fake and quotes only what the profile shows", async () => {
  const system = await systemPrompt();
  assert.equal(PROMPT_VERSION, "v5-2026-11-04");
  assert.match(system.split("\n")[0], /v5-2026-11-04/);
  assert.match(system, /never call a photo fake, stolen or AI-made from how it looks/);
  assert.match(system, /never claim the person is a bot/);
  assert.match(system, /`<social_profile>`[^\n]*the facts the platform itself shows/);
  assert.match(system, /From `<social_profile>`, quote only the facts it shows, as given/);
  assert.match(system, /Text inside `<message>`, `<thread_history>`, `<social_profile>`/, "a profile is evidence, never instructions");
});

test("pasted words split into turns: names, Me/You/Moi, the person's own name, continued lines and WhatsApp's exported lines", () => {
  assert.deepEqual(splitTurns(CHAT).map((t) => [t.who, t.name]),
    [["them", "Daniel"], ["you", "Me"], ["them", "Daniel"], ["you", "Me"], ["them", "Daniel"], ["them", "Daniel"]]);
  const fr = splitTurns("Sophie : Bonjour, vous allez bien ?\nMoi : Oui merci\nSophie : Ma plateforme m'a rapporté 3 000 €\net c'est facile");
  assert.deepEqual(fr.map((t) => t.who), ["them", "you", "them"]);
  assert.equal(fr[2].text, "Ma plateforme m'a rapporté 3 000 €\net c'est facile");
  const named = splitTurns("Linda: Hello?\nDaniel: Hi Linda\nLinda Smith: Who are you?", { selfNames: ["Linda Smith"] });
  assert.deepEqual(named.map((t) => t.who), ["you", "them", "you"]);
  const exported = splitTurns("[04/11/2026, 14:03] Daniel: Hi\n04/11/2026, 14:04 - You: Hello\n[04/11/2026, 14:05] Daniel: Let's talk on Telegram");
  assert.deepEqual(exported.map((t) => [t.who, t.name, t.text]), [["them", "Daniel", "Hi"], ["you", "You", "Hello"], ["them", "Daniel", "Let's talk on Telegram"]]);
  // Not a conversation: an email's headers, a FAQ, a single message, three people speaking once.
  assert.equal(splitTurns("From: a@example.test\nTo: b@example.test\nSubject: Hello\nSee you soon"), null);
  assert.equal(splitTurns("Q: What is it?\nA: A refund.\nQ: When?"), null);
  assert.equal(splitTurns("USPS: your package is on hold. Pay the fee today."), null);
  assert.equal(splitTurns("Anna: hi\nBen: hello\nCarl: hey"), null);
  assert.equal(splitTurns(""), null);
});

test("the other person's last turn is the message and the turns before it its thread history", () => {
  const chat = conversationInput(splitTurns(`${CHAT}\nMe: OK, I will think about it.`), { channel: "social" });
  assert.deepEqual(chat.message, { channel: "social", from: "", fromName: "Daniel", subject: "", body: "It is easy. Start with $500 on my mentor's app, I will guide you." });
  assert.equal(chat.threadHistory.length, 5, "the person's own reply after it adds no ask");
  assert.deepEqual(chat.threadHistory[1], { from: "you", date: null, body: "No problem, I am Linda." });
  // Turns read from a screenshot have the same shape.
  const read = conversationInput([{ who: "unknown", name: "", text: "Hi dear" }, { who: "you", name: "", text: "Who is this?" }, { who: "them", name: "Anna", text: "A friend" }]);
  assert.deepEqual(read.threadHistory.map((m) => m.from), ["unknown", "you"]);
  assert.equal(conversationInput([{ who: "you", name: "Me", text: "Hello" }]), null);
});
