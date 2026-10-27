// Trusted people ("guardians") and the one-tap loop from the PRD (A5):
// the senior chooses to ask, the guardian answers Scam / Real / I'll call
// you, and the answer lands on the senior's screen.
// A guardian only ever sees what the senior shared for that one message.

import { config } from "./config.js";
import { randomToken, sha256 } from "./crypto.js";
import { many, one, q } from "./db/pool.js";
import { sendEmail, buttonsHtml } from "./notify/email.js";
import { publish } from "./notify/sse.js";
import { audit } from "./sync/actions.js";

const DAY = 86400000;
const fr = (user) => String(user?.locale || "").toLowerCase().startsWith("fr");

export async function inviteGuardian({ senior, name, email, relation }) {
  const token = randomToken();
  const g = await one(`INSERT INTO guardianships (senior_id, guardian_name, guardian_email, relation, invite_hash, invite_expires_at)
                       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [senior.id, name.trim(), email.trim().toLowerCase(), relation?.trim() || null, sha256(token), new Date(Date.now() + 14 * DAY)]);
  const url = `${config.baseUrl}/invite/${token}`;
  const who = senior.name || senior.email;
  const F = fr(senior);
  await sendEmail({
    to: g.guardian_email,
    subject: F ? `${who} vous demande d'être sa personne de confiance` : `${who} asked you to be their trusted person`,
    text: F
      ? `Bonjour ${g.guardian_name},\n\n${who} utilise Scam Shield pour repérer les arnaques dans ses e-mails. Quand un message l'inquiète, Scam Shield peut vous le montrer pour avoir votre avis, en un geste.\n\nAccepter : ${url}\n\nVous ne verrez que les messages que ${who} choisit de partager.`
      : `Hi ${g.guardian_name},\n\n${who} uses Scam Shield to spot scams in their email. When a message worries them, Scam Shield can show it to you for a one-tap answer.\n\nAccept: ${url}\n\nYou will only ever see the messages ${who} chooses to share.`,
    html: buttonsHtml(
      F ? [`Bonjour ${g.guardian_name},`, `${who} utilise Scam Shield pour repérer les arnaques. Quand un message l'inquiète, vous pourrez donner votre avis en un geste.`]
        : [`Hi ${g.guardian_name},`, `${who} uses Scam Shield to spot scams. When a message worries them, you can answer with one tap.`],
      [{ href: url, label: F ? "Accepter" : "Accept", color: "#1f3a5f" }],
      F ? `Vous ne verrez que les messages que ${who} choisit de partager.` : `You will only ever see the messages ${who} chooses to share.`),
  });
  await audit(senior.id, "guardian_invited", { guardianshipId: g.id });
  return { guardianship: g, inviteUrl: url };
}

export async function inviteByToken(token) {
  return one(`SELECT g.*, u.name AS senior_name, u.email AS senior_email FROM guardianships g JOIN users u ON u.id = g.senior_id
              WHERE g.invite_hash = $1 AND g.status = 'invited' AND g.invite_expires_at > now()`, [sha256(token)]);
}

export async function acceptInvite({ token, user }) {
  const g = await inviteByToken(token);
  if (!g) return null;
  if (g.senior_id === user.id) throw new Error("You cannot be your own trusted person.");
  const updated = await one(`UPDATE guardianships SET guardian_id = $2, guardian_email = $3, status = 'active', accepted_at = now(), invite_hash = NULL
                             WHERE id = $1 RETURNING *`, [g.id, user.id, user.email.toLowerCase()]);
  publish(g.senior_id, "guardian", { guardianshipId: g.id, status: "active", name: g.guardian_name });
  await audit(g.senior_id, "guardian_accepted", { guardianshipId: g.id });
  return updated;
}

export async function alertGuardians({ senior, checkId, shared, guardianshipIds = null, auto = false }) {
  const targets = (await many("SELECT * FROM guardianships WHERE senior_id = $1 AND status = 'active'", [senior.id]))
    .filter((g) => !guardianshipIds || guardianshipIds.includes(g.id));
  const F = fr(senior);
  const who = senior.name || senior.email;
  const sentTo = [];
  for (const g of targets) {
    const token = randomToken();
    const alert = await one(`INSERT INTO alerts (senior_id, guardianship_id, check_id, shared, answer_hash, answer_expires_at)
                             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [senior.id, g.id, checkId || null, { ...shared, auto }, sha256(token), new Date(Date.now() + 3 * DAY)]);
    const link = (a) => `${config.baseUrl}/answer/${token}?a=${a}`;
    const lines = [
      F ? `${who} vous demande votre avis sur un message.` : `${who} would like your opinion on a message.`,
      `${F ? "De" : "From"} : ${shared.fromName || ""} <${shared.from || ""}>`,
      shared.subject ? `${F ? "Objet" : "Subject"} : ${shared.subject}` : "",
      `Scam Shield : ${shared.headline}`,
      ...(shared.reasons || []).map((r) => `• ${r}`),
      shared.text ? `\n${shared.text}` : "",
    ].filter(Boolean);
    await sendEmail({
      to: g.guardian_email,
      subject: F ? `${who} : est-ce une arnaque ?` : `${who}: is this a scam?`,
      text: `${lines.join("\n")}\n\n${F ? "Répondre" : "Answer"}: ${config.baseUrl}/answer/${token}`,
      html: buttonsHtml(lines, [
        { href: link("scam"), label: F ? "C'est une arnaque" : "It's a scam", color: "#b42318" },
        { href: link("real"), label: F ? "C'est un vrai message" : "It's real", color: "#2e7d32" },
        { href: link("call_me"), label: F ? "Je vous appelle" : "I'll call you", color: "#1f3a5f" },
      ], F ? "Vous confirmerez votre réponse sur la page qui s'ouvre." : "You will confirm your answer on the page that opens."),
    });
    if (g.guardian_id) publish(g.guardian_id, "alert", { alertId: alert.id, senior: who });
    sentTo.push(g.guardian_name);
  }
  if (sentTo.length) await audit(senior.id, auto ? "guardian_auto_alerted" : "guardian_asked", { checkId, to: sentTo.length });
  return sentTo;
}

export async function alertByToken(token) {
  return one(`SELECT a.*, g.guardian_name, g.guardian_id, u.name AS senior_name, u.email AS senior_email, u.locale AS senior_locale
              FROM alerts a JOIN guardianships g ON g.id = a.guardianship_id JOIN users u ON u.id = a.senior_id
              WHERE a.answer_hash = $1`, [sha256(token)]);
}

// Single use: the first answer wins; the token is erased with it.
export async function answerAlert({ alert, answer }) {
  if (!["scam", "real", "call_me"].includes(answer)) throw new Error("bad answer");
  if (alert.answered_at) return { already: true, alert };
  if (alert.answer_expires_at && alert.answer_expires_at < new Date() && alert.answer_hash) return { expired: true, alert };
  const updated = await one(`UPDATE alerts SET answer = $2, answered_at = now(), answer_hash = NULL
                             WHERE id = $1 AND answered_at IS NULL RETURNING *`, [alert.id, answer]);
  if (!updated) return { already: true, alert };
  const g = await one("SELECT guardian_name FROM guardianships WHERE id = $1", [updated.guardianship_id]);
  publish(updated.senior_id, "answer", { alertId: updated.id, checkId: updated.check_id, answer, guardianName: g?.guardian_name });
  await audit(updated.senior_id, "guardian_answered", { alertId: updated.id, answer });
  return { alert: updated };
}

export async function alertsForGuardian(guardianUserId) {
  return many(`SELECT a.id, a.shared, a.answer, a.answered_at, a.created_at, u.name AS senior_name, u.email AS senior_email, g.relation
               FROM alerts a JOIN guardianships g ON g.id = a.guardianship_id JOIN users u ON u.id = a.senior_id
               WHERE g.guardian_id = $1 AND g.status = 'active' ORDER BY a.created_at DESC LIMIT 100`, [guardianUserId]);
}

export async function answersForSenior(seniorId, since = null) {
  return many(`SELECT a.id, a.check_id, a.answer, a.answered_at, a.created_at, a.shared->>'subject' AS subject, g.guardian_name
               FROM alerts a JOIN guardianships g ON g.id = a.guardianship_id
               WHERE a.senior_id = $1 AND ($2::timestamptz IS NULL OR a.answered_at > $2) ORDER BY a.created_at DESC LIMIT 50`, [seniorId, since]);
}
