// Public demo (no sign-in): the PRD regression inbox and the two seed
// profiles, judged by the same engine. Used for the hackathon video and
// for anyone trying Scam Shield before connecting their own Gmail.

import { readFile } from "node:fs/promises";
import { checkMessage } from "../../lib/muse.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../../${p}`, import.meta.url), "utf8"));
const PROFILES = { linda: await load("data/profiles/linda.json"), francoise: await load("data/profiles/francoise.json") };
const CARDS = await load("data/patterns/cards.json");
const CASES = (await load("testcases/cases.json")).cases;
const DEMO_INBOX = CASES.map((c) => ({
  ...c.message, id: c.id, profile: c.profile, locale: c.locale,
  threadHistory: c.threadHistory || [], mockLinkInspection: c.mockLinkInspection || {},
  date: `Example ${c.id} · ${c.message.channel || "email"}`,
}));

export default async function demoRoutes(app) {
  app.get("/api/demo/inbox", async (request) => {
    const lang = request.query.lang === "fr" ? "fr" : request.query.lang === "en" ? "en" : null;
    return { emails: lang ? DEMO_INBOX.filter((e) => e.locale.startsWith(lang)) : DEMO_INBOX };
  });

  app.post("/api/demo/check", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.body || {};
    const e = DEMO_INBOX.find((x) => x.id === id);
    if (!e) return reply.code(404).send({ error: "unknown example" });
    return checkMessage({
      locale: e.locale, message: e, personalContext: PROFILES[e.profile], patternCards: CARDS,
      threadHistory: e.threadHistory, mockLinkInspection: e.mockLinkInspection, linkInspection: e.mockLinkInspection,
    });
  });
}
