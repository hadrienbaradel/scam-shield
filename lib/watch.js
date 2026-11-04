// Scam watch, the pure part (_product/specs/public-database.md, lines 8 to
// 10): a watch item is a breach, a technique or something else read from a
// public feed. This module turns a Have I Been Pwned breach into the fields a
// reviewer needs, says what makes an item "important" (the spec's explicit
// rule, never a model's feeling), and writes the one thing a senior should
// do about it, in English and French. No network, no database: the job
// (src/jobs/scamwatch.js) and the classifier (lib/watchMuse.js) call in.

export const WATCH_KINDS = ["breach", "technique", "other"];

// Data classes (HIBP's names) that make a leak serious whatever its size:
// credentials, bank, identity and health, plus what lets a scammer sound
// real on the phone (date of birth, address, phone number).
export const HIGH_DATA_CLASSES = ["Passwords", "Bank account numbers", "Credit cards", "Social security numbers", "Government issued IDs",
  "Health insurance information", "Medical records", "Dates of birth", "Physical addresses", "Phone numbers"];

const BANK_CLASSES = ["Bank account numbers", "Credit cards", "Partial credit card data", "Credit card CVV", "Payment histories"];
const DAY = 86400000;
const IMPORTANT_PEOPLE = 1000000;
const RECENT_DAYS = 30;

// A HIBP breach (https://haveibeenpwned.com/api/v3/breaches) as a watch
// item. "Verified" means HIBP confirmed it and it is none of the things
// HIBP also lists (fabricated, a spam list, malware or stealer logs).
export function breachFromHibp(b) {
  return {
    kind: "breach",
    title: b.Title,
    url: `https://haveibeenpwned.com/PwnedWebsites#${b.Name}`,
    source: "hibp",
    published_at: b.AddedDate,
    fields: {
      org: b.Title, domain: b.Domain, people: b.PwnCount, dataClasses: b.DataClasses,
      verified: Boolean(b.IsVerified && !b.IsFabricated && !b.IsSpamList && !b.IsMalware && !b.IsStealerLog),
      breachDate: b.BreachDate, addedDate: b.AddedDate, country: null, sourceKind: "hibp",
    },
  };
}

const count = (n) => Number(n).toLocaleString("en-US");

// The spec's rule (line 9): a verified breach of 1M+ people or of high-value
// data, added within 30 days; a technique not seen before, in the senior's
// country or everywhere. Reasons say which facts held, in plain words.
export function importanceOf(item, { countries = ["US", "FR"], now = new Date() } = {}) {
  const f = item?.fields || {};
  const reasons = [];
  if (item?.kind === "breach") {
    const people = Number(f.people) || 0;
    const high = (f.dataClasses || []).filter((c) => HIGH_DATA_CLASSES.includes(c));
    const added = Date.parse(f.addedDate);
    const recent = Number.isFinite(added) && now - added <= RECENT_DAYS * DAY;
    if (f.verified) reasons.push("verified by Have I Been Pwned");
    if (people >= IMPORTANT_PEOPLE) reasons.push(`${count(people)} people`);
    if (high.length) reasons.push(`${high.join(", ")} leaked`);
    if (recent) reasons.push("added in the last 30 days");
    return { important: Boolean(f.verified && (people >= IMPORTANT_PEOPLE || high.length) && recent), reasons };
  }
  if (item?.kind === "technique") {
    const fresh = f.novelty === "new";
    const here = f.country == null || countries.includes(f.country);
    if (fresh) reasons.push("a technique not seen before");
    if (here) reasons.push(f.country ? `seen in ${f.country}` : "no one country");
    return { important: Boolean(fresh && here), reasons };
  }
  return { important: false, reasons: [] };
}

// One line a senior can act on, per family (the ids of data/library/families.json).
const FAMILY_ACTIONS = {
  delivery: { en: "Do not pay a fee from a text or an email: look up your parcel on the carrier's own site or app.", fr: "Ne payez jamais de frais depuis un SMS ou un e-mail : suivez votre colis sur le site ou l'application du transporteur." },
  bank: { en: "Hang up or close the message, then call your bank on the number printed on your card.", fr: "Raccrochez ou fermez le message, puis appelez votre banque au numéro imprimé sur votre carte." },
  government: { en: "No agency asks for a payment or a code by text, email or phone: find the office's number yourself and call it.", fr: "Aucune administration ne demande un paiement ou un code par SMS, e-mail ou téléphone : cherchez vous-même le numéro du service et appelez-le." },
  "tech-support": { en: "Close the pop-up or hang up; never let a caller take control of your computer.", fr: "Fermez la fenêtre ou raccrochez ; ne laissez jamais quelqu'un prendre la main sur votre ordinateur." },
  "family-emergency": { en: "Hang up and call your relative back on the number you have always used for them.", fr: "Raccrochez et rappelez votre proche sur le numéro que vous avez toujours utilisé pour lui." },
  "new-number": { en: "A 'new number' is a claim: call the old number first before you save or send anything.", fr: "Un « nouveau numéro » est une affirmation : appelez d'abord l'ancien numéro avant d'enregistrer ou d'envoyer quoi que ce soit." },
  romance: { en: "Never send money or gift cards to someone you have only met online, whatever the story.", fr: "N'envoyez jamais d'argent ni de cartes cadeaux à quelqu'un rencontré seulement en ligne, quelle que soit l'histoire." },
  investment: { en: "Guaranteed returns do not exist: talk to your bank before you move any money.", fr: "Les rendements garantis n'existent pas : parlez-en à votre banque avant de déplacer le moindre argent." },
  prize: { en: "A real prize never costs a fee or a code: delete the message.", fr: "Un vrai gain ne coûte jamais de frais ni de code : supprimez le message." },
  charity: { en: "Give through the charity's own website, never through a link or a caller.", fr: "Donnez sur le site de l'association elle-même, jamais par un lien ou un appel." },
  job: { en: "A real employer never asks you to pay, to buy equipment or to move money for them.", fr: "Un vrai employeur ne vous demande jamais de payer, d'acheter du matériel ou de déplacer de l'argent pour lui." },
  rental: { en: "Never pay a deposit before you have visited the place and met the owner.", fr: "Ne versez jamais de caution avant d'avoir visité le logement et rencontré le propriétaire." },
  renewal: { en: "Check the renewal in the account you already have, not through the message's link.", fr: "Vérifiez le renouvellement dans le compte que vous avez déjà, pas via le lien du message." },
  "toll-fine": { en: "Pay tolls and fines only on the official site you type yourself; delete the text.", fr: "Payez péages et amendes uniquement sur le site officiel que vous tapez vous-même ; supprimez le SMS." },
  utility: { en: "Before you pay, call your provider on the number from your last real bill.", fr: "Avant de payer, appelez votre fournisseur au numéro de votre dernière vraie facture." },
  account: { en: "Do not use the message's link: open the service yourself and check there.", fr: "N'utilisez pas le lien du message : ouvrez le service vous-même et vérifiez sur place." },
  sextortion: { en: "Do not pay and do not answer; keep the message and tell someone you trust.", fr: "Ne payez pas et ne répondez pas ; gardez le message et parlez-en à quelqu'un de confiance." },
  invoice: { en: "Check the invoice against the orders you actually placed before paying anything.", fr: "Comparez la facture avec les commandes que vous avez vraiment passées avant de payer." },
  marketplace: { en: "Pay only through the marketplace itself, never by transfer, gift card or a link sent to you.", fr: "Payez uniquement via la plateforme elle-même, jamais par virement, carte cadeau ou lien reçu." },
  health: { en: "Call your insurer or your doctor's office on the number you already have.", fr: "Appelez votre assurance ou le cabinet de votre médecin au numéro que vous avez déjà." },
  recovery: { en: "Nobody can get lost money back for a fee: do not pay anyone who promises it.", fr: "Personne ne récupère de l'argent perdu contre des frais : ne payez personne qui le promet." },
};
const GENERAL_ACTION = { en: "Do not act on the message; ask someone you trust before you click, pay or answer.", fr: "Ne faites rien depuis le message ; demandez à quelqu'un de confiance avant de cliquer, payer ou répondre." };

const bothLines = (a) => a && typeof a.en === "string" && a.en.trim() && typeof a.fr === "string" && a.fr.trim() ? { en: a.en.trim(), fr: a.fr.trim() } : null;

export function oneActionFor(item) {
  const f = item?.fields || {};
  if (item?.kind === "breach") {
    const classes = f.dataClasses || [];
    const org = f.org || "that site";
    if (classes.includes("Passwords")) {
      return { en: `Change your password on ${org}, and anywhere else you used the same one.`, fr: `Changez votre mot de passe sur ${org}, et partout où vous aviez le même.` };
    }
    if (classes.some((c) => BANK_CLASSES.includes(c))) {
      return { en: `Watch your bank statements, and expect calls that quote the ${org} leak: hang up and call your bank yourself.`,
        fr: `Surveillez vos relevés bancaires, et attendez-vous à des appels citant la fuite ${org} : raccrochez et appelez votre banque vous-même.` };
    }
    return { en: `Expect emails or calls that quote the ${org} leak; they prove nothing. Do not click, pay or answer because of it.`,
      fr: `Attendez-vous à des e-mails ou des appels citant la fuite ${org} ; cela ne prouve rien. Ne cliquez pas, ne payez pas et ne répondez pas pour autant.` };
  }
  if (item?.kind === "technique") return bothLines(f.one_action) || FAMILY_ACTIONS[f.family] || GENERAL_ACTION;
  return GENERAL_ACTION;
}
