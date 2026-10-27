// In-memory Gmail with the same surface as src/google/gmail.js gmailClient.
// Records every label change so tests can prove nothing is trashed.

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

// Gmail's real header shape: each result names the domain it vouches for,
// aligned with the From address.
export function googleAuthResults(auth, from) {
  const addr = (String(from).match(/<([^>]+)>/)?.[1] || String(from)).toLowerCase();
  const domain = addr.split("@").pop();
  const r = (k) => String(auth).match(new RegExp(`${k}=(\\w+)`))?.[1] || "none";
  return `mx.google.com; dkim=${r("dkim")} header.i=@${domain} header.s=s1; spf=${r("spf")} (google.com: domain of ${addr}) smtp.mailfrom=${addr}; dmarc=${r("dmarc")} (p=REJECT) header.from=${domain}`;
}

export function gmailMessage({ id, threadId, from, subject, text = "", html = "", auth = "spf=pass dkim=pass dmarc=pass", labels = ["INBOX"], date = Date.now(), to }) {
  const parts = [];
  if (text) parts.push({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }], body: { data: b64(text) } });
  if (html) parts.push({ mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: { data: b64(html) } });
  return {
    id, threadId: threadId || id, labelIds: labels, snippet: (text || html).slice(0, 80), internalDate: String(date),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: from }, { name: "Subject", value: subject }, ...(to ? [{ name: "To", value: to }] : []),
        { name: "Authentication-Results", value: googleAuthResults(auth, from) },
      ],
      parts,
    },
  };
}

export function fakeGmail({ email = "linda@example.test", messages = [] } = {}) {
  const store = new Map(messages.map((m) => [m.id, structuredClone(m)]));
  const labels = [{ id: "INBOX", name: "INBOX" }, { id: "SENT", name: "SENT" }];
  let historyId = 100;
  const history = [];
  const modifications = [];
  const matches = (m, { q = "", labelIds } = {}) => {
    if (labelIds?.length && !labelIds.every((l) => m.labelIds.includes(l))) return false;
    if (/(^|\s)-in:sent/.test(q)) return !m.labelIds.includes("SENT");
    if (/(^|\s)in:sent/.test(q)) return m.labelIds.includes("SENT");
    return true;
  };
  return {
    modifications, store,
    deliver(m) { store.set(m.id, structuredClone(m)); historyId++; history.push({ id: String(historyId), messagesAdded: [{ message: { id: m.id, labelIds: m.labelIds } }] }); },
    profile: async () => ({ emailAddress: email, historyId: String(historyId) }),
    listMessages: async (query = {}) => ({ messages: [...store.values()].filter((m) => matches(m, query)).slice(0, query.maxResults || 100).map((m) => ({ id: m.id, threadId: m.threadId })) }),
    getMessage: async (id) => {
      if (!store.has(id)) { const e = new Error("not found"); e.status = 404; throw e; }
      return structuredClone(store.get(id));
    },
    getThread: async (id) => ({ id, messages: [...store.values()].filter((m) => m.threadId === id) }),
    listHistory: async (start) => ({ history: history.filter((h) => Number(h.id) > Number(start)), historyId: String(historyId) }),
    listLabels: async () => ({ labels }),
    createLabel: async (name) => { const l = { id: `Label_${labels.length}`, name }; labels.push(l); return l; },
    modifyLabels: async (id, { add = [], remove = [] }) => {
      if ([...add, ...remove].some((l) => ["TRASH", "SPAM"].includes(l))) throw new Error("forbidden");
      modifications.push({ id, add, remove });
      const m = store.get(id);
      m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add])];
      return m;
    },
    watch: async () => ({ historyId: String(historyId), expiration: String(Date.now() + 7 * 86400000) }),
    stop: async () => null,
  };
}
