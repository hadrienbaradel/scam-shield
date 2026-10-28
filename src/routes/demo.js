// Public demo (no sign-in): the PRD regression inbox and the two seed
// profiles, judged by the same engine. Used for the hackathon video and
// for anyone trying Scam Shield before connecting their own Gmail.

import { readFile } from "node:fs/promises";
import { checkMessage } from "../../lib/muse.js";
import { callBackFor } from "../../lib/context.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../../${p}`, import.meta.url), "utf8"));
const PROFILES = { linda: await load("data/profiles/linda.json"), francoise: await load("data/profiles/francoise.json") };
const CARDS = await load("data/patterns/cards.json");
const CASES = (await load("testcases/cases.json")).cases;
const DEMO_INBOX = CASES.map((c) => ({
  ...c.message, id: c.id, profile: c.profile, locale: c.locale,
  threadHistory: c.threadHistory || [], mockLinkInspection: c.mockLinkInspection || {},
  date: `Example ${c.id} · ${c.message.channel || "email"}`,
}));

// The demo "Today": a few messages that need the person, as on a real
// morning. Their verdicts are computed live when a card opens.
const PERSONAS = {
  en: { profile: "linda", today: ["D1", "B2", "D7"] },
  fr: { profile: "francoise", today: ["A4", "B1", "A6"] },
};
const summary = (e) => ({ id: e.id, channel: e.channel, fromName: e.fromName || "", from: e.from || "", subject: e.subject || "", body: e.body, links: e.links || [] });

const demoVerdicts = new Map();

export default async function demoRoutes(app) {
  app.get("/api/demo/today", async (request) => {
    const lang = request.query.lang === "fr" ? "fr" : "en";
    const persona = PERSONAS[lang];
    const profile = PROFILES[persona.profile];
    const guardian = (profile.trustedContacts || []).find((c) => /guardian/i.test(c.relation || ""));
    return {
      name: profile.userName,
      guardian: guardian ? { name: guardian.name, phone: guardian.phone || null } : null,
      checked: DEMO_INBOX.filter((e) => e.locale.startsWith(lang)).length,
      queue: persona.today.map((id) => summary(DEMO_INBOX.find((e) => e.id === id))),
    };
  });

  app.get("/api/demo/inbox", async (request) => {
    const lang = request.query.lang === "fr" ? "fr" : request.query.lang === "en" ? "en" : null;
    return { emails: lang ? DEMO_INBOX.filter((e) => e.locale.startsWith(lang)) : DEMO_INBOX };
  });

  app.post("/api/demo/check", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.body || {};
    const e = DEMO_INBOX.find((x) => x.id === id);
    if (!e) return reply.code(404).send({ error: "unknown example" });
    // Same example, same answer: judges and the video see stable verdicts,
    // and a repeat view costs no model call. Failures are not kept.
    const hit = demoVerdicts.get(e.id);
    if (hit) return hit;
    const verdict = await checkMessage({
      locale: e.locale, message: e, personalContext: PROFILES[e.profile], patternCards: CARDS,
      threadHistory: e.threadHistory, mockLinkInspection: e.mockLinkInspection, linkInspection: e.mockLinkInspection,
    });
    const out = { ...verdict, callBack: callBackFor(PROFILES[e.profile], e) };
    if (!verdict.degraded) demoVerdicts.set(e.id, out);
    return out;
  });
}
