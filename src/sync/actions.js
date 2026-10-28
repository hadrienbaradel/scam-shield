// What Scam Shield does to a message after judging it. Pure decision first
// (tested on its own), then the Gmail calls.
// - safe: nothing.
// - be_careful: label "Scam Shield/Check first", stays in the inbox.
// - scam: label "Scam Shield/Scam"; moved out of the inbox only when the
//   person explicitly chose "move" (consent recorded), the AI check did not
//   fail half-way, and the sender is not an authenticated sender this user
//   already knows (a known sender, a provider's real address, a trusted
//   contact). Otherwise labeled only: a mistake must never hide real mail.
// Every move can be undone with "Put it back".

import { domainOf, sameOrSub } from "../../lib/brands.js";
import { one, q } from "../db/pool.js";

const authOk = (auth) => /(spf|dkim)=pass/.test(auth || "") && !/(spf|dkim|dmarc)=fail/.test(auth || "");

export function isProtectedSender(message, ctx = {}) {
  if (!authOk(message.auth)) return false;
  const from = String(message.from || "").toLowerCase();
  const d = domainOf(from);
  return (ctx.knownSenders || []).some((s) => s.email?.toLowerCase() === from)
    || (ctx.providers || []).some((p) => (p.realDomains || []).some((rd) => sameOrSub(d, rd)))
    || (ctx.trustedContacts || []).some((c) => c.email?.toLowerCase() === from);
}

export function decideAction({ verdict, message, ctx, actMode, moveConsent = false }) {
  if (verdict.verdict === "safe") return { label: null, removeInbox: false, protectedSender: false };
  const protectedSender = isProtectedSender(message, ctx);
  const mayMove = actMode === "move" && moveConsent && !verdict.degraded;
  return {
    label: verdict.verdict === "scam" ? "scam" : "careful",
    removeInbox: verdict.verdict === "scam" && mayMove && !protectedSender,
    protectedSender,
  };
}

export async function applyDecision(client, labels, messageId, decision) {
  if (!decision.label) return "none";
  await client.modifyLabels(messageId, { add: [labels[decision.label]], remove: decision.removeInbox ? ["INBOX"] : [] });
  return decision.removeInbox ? "moved" : "labeled";
}

export async function audit(userId, event, detail = {}) {
  await q("INSERT INTO audit_log (user_id, event, detail) VALUES ($1, $2, $3)", [userId, event, detail]);
}

// "This is not a scam": back to the inbox, labels off, and the sender is
// remembered so it is recognised next time.
export async function putBack({ client, userId, check, labels, message }) {
  await client.modifyLabels(check.gmail_message_id, { add: ["INBOX"], remove: [labels.scam, labels.careful].filter(Boolean) });
  await q("UPDATE checks SET restored_at = now(), user_feedback = 'not_scam' WHERE id = $1", [check.id]);
  if (message?.from) {
    const row = await one("SELECT data FROM contexts WHERE user_id = $1", [userId]);
    if (row) {
      const ctx = row.data;
      if (!(ctx.knownSenders || []).some((s) => s.email === message.from)) {
        ctx.knownSenders = [...(ctx.knownSenders || []), { name: message.fromName || message.from, email: message.from, brand: null, confirmedByUser: true }];
        await q("UPDATE contexts SET data = $2, updated_at = now() WHERE user_id = $1", [userId, ctx]);
      }
    }
  }
  await audit(userId, "put_back", { checkId: check.id, messageId: check.gmail_message_id });
}

// "Undo" right after "Throw it away": the message goes back where it was
// (in the inbox, with its Scam Shield label) and nothing is learned about
// the sender, unlike "Put it back", which says the sender is fine.
export async function undoThrow({ client, userId, check, labels }) {
  const careful = check.verdict_value === "be_careful";
  await client.modifyLabels(check.gmail_message_id, {
    add: ["INBOX", careful ? labels.careful : labels.scam].filter(Boolean),
    remove: careful ? [labels.scam].filter(Boolean) : [],
  });
  await q("UPDATE checks SET action = 'labeled', user_feedback = NULL WHERE id = $1", [check.id]);
  await audit(userId, "throw_undone", { checkId: check.id, messageId: check.gmail_message_id });
}

// "Yes, it's a scam — take it away": the user overrules a Be careful.
export async function fileAsScam({ client, userId, check, labels }) {
  await client.modifyLabels(check.gmail_message_id, { add: [labels.scam], remove: ["INBOX", labels.careful].filter(Boolean) });
  await q("UPDATE checks SET action = 'moved', user_feedback = 'is_scam' WHERE id = $1", [check.id]);
  await audit(userId, "filed_as_scam", { checkId: check.id, messageId: check.gmail_message_id });
}
