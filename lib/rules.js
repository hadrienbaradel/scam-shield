// Deterministic phishing checks. No AI here on purpose: every signal a
// judge (or a family member) sees can be pointed at in the email itself.

const BRANDS = [
  { name: "PayPal", domains: ["paypal.com"] },
  { name: "Chase Bank", domains: ["chase.com", "jpmorganchase.com"] },
  { name: "Bank of America", domains: ["bankofamerica.com", "bofa.com"] },
  { name: "Wells Fargo", domains: ["wellsfargo.com"] },
  { name: "Amazon", domains: ["amazon.com"] },
  { name: "Apple", domains: ["apple.com", "icloud.com"] },
  { name: "Microsoft", domains: ["microsoft.com", "outlook.com"] },
  { name: "Netflix", domains: ["netflix.com"] },
  { name: "the IRS", domains: ["irs.gov"] },
  { name: "Social Security", domains: ["ssa.gov"] },
  { name: "Medicare", domains: ["medicare.gov", "cms.gov"] },
  { name: "USPS", domains: ["usps.com"] },
  { name: "FedEx", domains: ["fedex.com"] },
  { name: "UPS", domains: ["ups.com"] },
];

const FREE_MAIL = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "proton.me", "protonmail.com"];
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "cutt.ly", "shorturl.at"];
const RISKY_TLDS = [".xyz", ".top", ".click", ".buzz", ".work", ".live", ".online", ".site", ".fun"];

const URGENCY = [
  "urgent", "immediately", "act now", "within 24 hours", "account will be closed",
  "account has been suspended", "verify now", "final notice", "legal action",
  "arrest", "warrant", "suspended", "locked", "unusual activity",
];
const MONEY_LURES = [
  "gift card", "gift cards", "wire transfer", "bitcoin", "cryptocurrency",
  "cash app", "zelle", "venmo", "you have won", "lottery", "prize", "refund",
  "inheritance", "payment failed", "update your payment",
];
const CREDENTIAL_LURES = [
  "confirm your password", "enter your password", "social security number",
  "verify your identity", "sign in to verify", "update your information",
  "one-time code", "verification code",
];

function domainOf(value = "") {
  const m = String(value).toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  if (m) return m[1];
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function brandClaimed(text = "") {
  const t = text.toLowerCase();
  return BRANDS.filter((b) => t.includes(b.name.toLowerCase().replace(/^the /, "")) || b.domains.some((d) => t.includes(d.split(".")[0])));
}

function extractLinks(email) {
  const links = [...(email.links || [])];
  const body = email.body || "";
  for (const m of body.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) links.push({ text: m[1], href: m[2] });
  for (const m of body.matchAll(/(?<!\()https?:\/\/[^\s<>"')]+/g)) {
    if (!links.some((l) => l.href === m[0])) links.push({ text: m[0], href: m[0] });
  }
  return links;
}

export function analyzeEmail(email) {
  const signals = [];
  const add = (points, title, plain) => signals.push({ points, title, plain });
  const fromDomain = domainOf(email.from || "");
  const replyDomain = domainOf(email.replyTo || "");
  const haystack = `${email.fromName || ""} ${email.subject || ""} ${email.body || ""}`;
  const claimed = brandClaimed(`${email.fromName || ""} ${email.subject || ""}`);
  const links = extractLinks(email);

  for (const brand of claimed) {
    if (fromDomain && !brand.domains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`))) {
      add(35, `It says it is ${brand.name}, but it is not from ${brand.name}`,
        `The sender's address ends in "${fromDomain}". Real messages from ${brand.name} come from ${brand.domains[0]}.`);
    }
  }
  if (claimed.length && FREE_MAIL.includes(fromDomain)) {
    add(20, "A big company would not email you from a free address",
      `Banks, the IRS and Medicare do not send official mail from ${fromDomain}.`);
  }
  if (replyDomain && fromDomain && replyDomain !== fromDomain) {
    add(15, "Replies would go to a different address",
      `If you reply, your answer goes to ${replyDomain}, not to the sender. That is a common trick.`);
  }
  if (/xn--/.test(fromDomain) || /xn--/.test(haystack)) {
    add(25, "The address uses disguised letters", "The sender address contains hidden look-alike letters meant to fool your eye.");
  }

  for (const link of links) {
    const hrefDomain = domainOf(link.href);
    const textDomain = domainOf(link.text || "");
    if (textDomain && hrefDomain && textDomain !== hrefDomain) {
      add(30, "The button hides where it really goes",
        `The email shows "${link.text}" but the button actually leads to ${hrefDomain}. Never trust the words on a button.`);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hrefDomain)) add(20, "The link goes to a bare number address", "Real companies use names, not raw numbers, for their websites.");
    if (SHORTENERS.includes(hrefDomain)) add(15, "The link is shortened so you cannot see it", "Shortened links hide the real destination. A real bank will not send you one.");
    if (RISKY_TLDS.some((t) => hrefDomain.endsWith(t))) add(10, "The website address looks throwaway", `Addresses ending in ${hrefDomain.split(".").pop()} are cheap and often used for one-day scams.`);
    for (const brand of claimed) {
      if (hrefDomain && !brand.domains.some((d) => hrefDomain === d || hrefDomain.endsWith(`.${d}`)) && !FREE_MAIL.includes(hrefDomain)) {
        add(20, `The link does not go to ${brand.name}`, `The link leads to ${hrefDomain}. If this were really ${brand.name}, it would lead to ${brand.domains[0]}.`);
      }
    }
  }

  const lower = haystack.toLowerCase();
  const hits = (list) => list.filter((p) => lower.includes(p));
  if (hits(URGENCY).length) add(15, "It tries to rush you", "Scammers push you to act fast so you do not have time to think or ask someone. Real banks give you time.");
  if (hits(MONEY_LURES).length) add(20, "It talks about money in a risky way", "Gift cards, wire transfers and crypto are how scammers ask to be paid, because that money cannot be recovered.");
  if (hits(CREDENTIAL_LURES).length) add(20, "It asks for secret information", "No real bank, agency or company will ask for your password or Social Security number by email.");
  if ((email.auth || "").toLowerCase().includes("spf=fail") || (email.auth || "").toLowerCase().includes("dkim=fail")) {
    add(20, "Its identity papers do not check out", "Technical checks on this email failed. That means anyone could have sent it pretending to be the sender.");
  }
  if (/(attachment|invoice attached|open the attached|enable macros)/i.test(haystack)) {
    add(10, "It pushes you to open an attachment", "Unexpected attachments are a common way to put harmful software on a computer.");
  }

  const seen = new Set();
  const unique = signals.filter((s) => (seen.has(s.title) ? false : (seen.add(s.title), true)));
  signals.length = 0;
  signals.push(...unique);
  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  const verdict = score >= 45 ? "danger" : score >= 20 ? "caution" : "ok";
  return { score, verdict, signals, linksChecked: links.length };
}

export const VERDICT_COPY = {
  danger: { headline: "STOP. This looks like a scam.", action: "Do not click anything. Do not reply. Do not call any number in this email." },
  caution: { headline: "Be careful. Something is not right.", action: "Do not click yet. Check with a person you trust, or call the company on a number you already know." },
  ok: { headline: "Nothing alarming found.", action: "This is not a guarantee. Still never share passwords or codes by email." },
};
