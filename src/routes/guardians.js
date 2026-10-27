// Trusted people. Senior side: invite, list, remove. Guardian side: the
// alerts shared with me and one-tap answers. Plus the two pages opened
// from email: /invite/:token and /answer/:token (GET shows a confirm
// form, only POST records the answer, so link scanners can't answer).

import { requireUser } from "../auth.js";
import { many, one, q } from "../db/pool.js";
import { inviteGuardian, inviteByToken, alertsForGuardian, alertByToken, answerAlert } from "../guardians.js";
import { audit } from "../sync/actions.js";
import { page, esc } from "../pages.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ANSWERS = {
  en: { scam: "It's a scam", real: "It's real", call_me: "I'll call you" },
  fr: { scam: "C'est une arnaque", real: "C'est un vrai message", call_me: "Je vous appelle" },
};
const langOf = (locale) => (String(locale || "").startsWith("fr") ? "fr" : "en");

export default async function guardianRoutes(app) {
  app.register(async (priv) => {
    priv.addHook("preHandler", requireUser);

    priv.get("/api/guardians", async (request) => ({
      guardians: await many(`SELECT id, guardian_name AS name, guardian_email AS email, relation, status, created_at, accepted_at
                             FROM guardianships WHERE senior_id = $1 AND status <> 'revoked' ORDER BY created_at`, [request.user.id]),
    }));

    priv.post("/api/guardians", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { name = "", email = "", relation = "" } = request.body || {};
      if (!name.trim() || !EMAIL.test(email.trim())) return reply.code(400).send({ error: "Please give a name and an email address." });
      if (email.trim().toLowerCase() === request.user.email.toLowerCase()) return reply.code(400).send({ error: "Choose someone other than yourself." });
      const { guardianship, inviteUrl } = await inviteGuardian({ senior: request.user, name, email, relation });
      return { id: guardianship.id, status: guardianship.status, inviteUrl };
    });

    priv.delete("/api/guardians/:id", async (request) => {
      await q("UPDATE guardianships SET status = 'revoked', invite_hash = NULL WHERE id = $1 AND senior_id = $2", [request.params.id, request.user.id]);
      await audit(request.user.id, "guardian_removed", { guardianshipId: request.params.id });
      return { ok: true };
    });

    priv.get("/api/guardian/alerts", async (request) => ({
      alerts: await alertsForGuardian(request.user.id),
      protecting: await many(`SELECT g.id, u.name, u.email, g.relation FROM guardianships g JOIN users u ON u.id = g.senior_id
                              WHERE g.guardian_id = $1 AND g.status = 'active'`, [request.user.id]),
    }));

    priv.post("/api/guardian/alerts/:id/answer", async (request, reply) => {
      const alert = await one(`SELECT a.* FROM alerts a JOIN guardianships g ON g.id = a.guardianship_id
                               WHERE a.id = $1 AND g.guardian_id = $2 AND g.status = 'active'`, [request.params.id, request.user.id]);
      if (!alert) return reply.code(404).send({ error: "This alert is not yours to answer." });
      const out = await answerAlert({ alert: { ...alert, answer_expires_at: null }, answer: request.body?.answer });
      return { ok: true, already: Boolean(out.already) };
    });
  });

  app.get("/invite/:token", async (request, reply) => {
    const g = await inviteByToken(request.params.token);
    reply.type("text/html");
    if (!g) return page({ title: "Invitation", body: `<h1>This invitation has expired or was already used.</h1><p>Ask for a new one if you still want to help.</p>` });
    const who = esc(g.senior_name || g.senior_email);
    return page({
      title: "Invitation",
      body: `<h1>${who} would like you as their trusted person</h1>
<p>When a message worries ${who}, Scam Shield can show it to you so you can answer with one tap: <strong>scam</strong>, <strong>real</strong>, or <strong>I'll call you</strong>.</p>
<p>You will only see the messages ${who} chooses to share. Signing in does not give Scam Shield any access to your own email.</p>
<a class="btn btn-navy btn-big" href="/auth/google?mode=basic&amp;invite=${encodeURIComponent(request.params.token)}">Sign in with Google to accept</a>`,
    });
  });

  app.get("/answer/:token", async (request, reply) => {
    const alert = await alertByToken(request.params.token);
    reply.type("text/html");
    if (!alert) return page({ title: "Answer", body: "<h1>This link was already used or has expired.</h1><p>If you are signed in, your alerts are on your Scam Shield page.</p>" });
    const lang = langOf(alert.senior_locale);
    const s = alert.shared;
    const who = esc(alert.senior_name || alert.senior_email);
    const pre = ["scam", "real", "call_me"].includes(request.query.a) ? request.query.a : null;
    const fr = lang === "fr";
    const buttons = Object.entries(ANSWERS[lang]).map(([k, label]) =>
      `<button class="btn btn-big ${k === "scam" ? "btn-danger" : k === "real" ? "btn-ok" : "btn-navy"}${pre === k ? " preselected" : ""}" name="answer" value="${k}" type="submit">${esc(label)}</button>`).join("");
    return page({
      lang, title: fr ? "Votre avis" : "Your answer",
      body: `<h1>${fr ? `${who} vous demande votre avis` : `${who} asks for your opinion`}</h1>
<div class="shared-card"><p class="mail-meta">${fr ? "De" : "From"} : ${esc(s.fromName)} &lt;${esc(s.from)}&gt;</p>
${s.subject ? `<p><strong>${esc(s.subject)}</strong></p>` : ""}
<p class="verdict-line">Scam Shield : ${esc(s.headline)}</p>
<ul>${(s.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
${s.text ? `<pre class="mail-body">${esc(s.text)}</pre>` : ""}</div>
<form method="post" action="/answer/${encodeURIComponent(request.params.token)}" class="answer-form">${buttons}</form>
<p class="small">${fr ? "Votre réponse s'affiche aussitôt sur l'écran de" : "Your answer appears right away on the screen of"} ${who}.</p>`,
    });
  });

  app.post("/answer/:token", async (request, reply) => {
    const alert = await alertByToken(request.params.token);
    reply.type("text/html");
    if (!alert) return page({ title: "Answer", body: "<h1>This link was already used or has expired.</h1>" });
    const lang = langOf(alert.senior_locale);
    const out = await answerAlert({ alert, answer: request.body?.answer });
    if (out.expired) return page({ lang, title: "Answer", body: "<h1>This link has expired.</h1>" });
    const who = esc(alert.senior_name || alert.senior_email);
    return page({
      lang, title: lang === "fr" ? "Merci" : "Thank you",
      body: lang === "fr" ? `<h1>Merci.</h1><p>${who} voit maintenant votre réponse : <strong>${esc(ANSWERS.fr[request.body.answer])}</strong>.</p>`
        : `<h1>Thank you.</h1><p>${who} can now see your answer: <strong>${esc(ANSWERS.en[request.body.answer])}</strong>.</p>`,
    });
  });
}
