// A conversation, not one message: the costliest scams (a stranger's
// friendly opener, then investment talk) ask for nothing for weeks, so a
// chat is judged as a whole (_product/specs/messenger-channel.md, lines 3
// and 15). This turns pasted words into turns and turns into the engine's
// input: the other person's last turn is the message, every turn before it
// is the thread history.
//
// A turn is a line "Name: words". "Me:", "You:", "Moi:", "Vous:" or the
// person's own name is the person we protect; anyone else is the other
// person. A line without a speaker continues the turn above it. WhatsApp's
// exported lines ("[04/11/2026, 14:03] Daniel: …", "04/11/2026, 14:03 -
// Daniel: …") work too. Turns have the shape the screenshot reader gives a
// chat ({ who: "them" | "you" | "unknown", name, text }), so both paths
// share conversationInput.

const SELF = new Set(["me", "you", "moi", "vous", "myself"]);
// Labels that make "Key: value" lines (email headers, receipts, forms,
// FAQs), not speakers.
const NOT_A_NAME = new Set([
  "from", "to", "subject", "date", "sent", "cc", "bcc", "reply-to", "re", "fw", "fwd", "objet", "de", "à", "envoyé", "le",
  "name", "nom", "phone", "tel", "tél", "mobile", "email", "e-mail", "address", "adresse", "time", "heure", "when", "where",
  "amount", "montant", "total", "price", "prix", "order", "commande", "ref", "reference", "référence", "tracking", "suivi",
  "account", "compte", "card", "carte", "code", "status", "statut", "note", "nb", "ps", "p.s", "q", "a", "question", "answer",
  "réponse", "step", "étape", "warning", "attention", "important", "update", "notice", "link", "lien", "url", "website", "site",
  "http", "https",
]);
const STAMP = /^(?:\[[^\]]{1,40}\]\s*|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}[:h]\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?\s*[-–]\s*)/i;
// A name: up to 40 characters and 4 words, starting with a letter, a "+"
// or a "(" (a phone number), then ": " and the words.
const SPEAKER = /^([\p{L}+(][\p{L}\p{N} .'’()+-]{0,39}?)\s*:\s+(\S.*)$/u;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

function speakerOf(line) {
  const m = line.replace(STAMP, "").match(SPEAKER);
  if (!m) return null;
  const name = m[1].trim().replace(/\s+/g, " ");
  if (name.split(" ").length > 4 || NOT_A_NAME.has(norm(name).replace(/\.$/, ""))) return null;
  return { name, text: m[2].trim() };
}

// The turns of a pasted chat, or null when the words are not one: a
// conversation has at least three turns between at least two speakers, and
// someone speaks twice (three "Key: value" lines are a form, not a chat).
// selfNames: the person's own names ("Linda", "Linda Smith"), so a chat
// pasted with their name instead of "Me" still knows who is who.
export function splitTurns(text, { selfNames = [] } = {}) {
  const self = new Set([...SELF, ...selfNames.filter(Boolean).flatMap((n) => [norm(n), norm(n).split(" ")[0]])]);
  const turns = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const s = speakerOf(line);
    if (s) turns.push({ who: self.has(norm(s.name)) ? "you" : "them", name: s.name, text: s.text });
    else if (turns.length) turns.at(-1).text += `\n${line}`;
  }
  const counts = new Map();
  for (const t of turns) counts.set(norm(t.name), (counts.get(norm(t.name)) || 0) + 1);
  if (turns.length < 3 || counts.size < 2 || Math.max(...counts.values()) < 2) return null;
  return turns;
}

// The engine's input for a conversation: the other person's last turn is
// the message (the person's own replies after it add no ask), the turns
// before it are thread_history, oldest first, "you" marking the person we
// protect. null when only the person themselves speaks.
export function conversationInput(turns, { channel = "social" } = {}) {
  const last = (turns || []).findLastIndex((t) => t.who !== "you");
  if (last < 0) return null;
  const them = turns[last];
  return {
    message: { channel, from: "", fromName: them.name || "", subject: "", body: them.text },
    threadHistory: turns.slice(0, last).map((t) => ({
      from: t.who === "you" ? "you" : t.name || (t.who === "unknown" ? "unknown" : "them"), date: null, body: t.text,
    })),
  };
}
