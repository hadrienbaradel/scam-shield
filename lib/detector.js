// Scam Shield detector: cheap deterministic pass over personal context,
// auth, links, pattern cards and thread history. This is the fallback and
// the evidence-gatherer; Muse Spark (lib/muse.js) may rewrite wording,
// but it receives these facts and the same schema. PRD rules live here:
// breach data raises risk, candidate cards cap at be_careful, real senders
// matching history are never marked scam (except hacked known contacts).

import { domainOf, belongsTo, claimedBrands, brandByName, lookalikeOf, FREEMAIL, countryOf, brandCountry, sameOrSub, mentions, platformFor, brandInDomain } from "./brands.js";
import { inspectLinks } from "./linkInspector.js";
import { matchCards } from "./patterns.js";
import { providerFor, trustedContactFor, claimedContactFor, matchingOrder, breachLeaking } from "./context.js";
const digits = (s) => String(s || "").replace(/\D/g, "");
import { validateVerdict } from "./schema.js";

const RE = {
  urgency: /(urgent|immediately|act now|within \d+ (hours|days)|act within|final notice|suspended|will be (closed|locked)|legal action|arrest|pay today|avoid (fees|penalty)|dans \d+ jours|urgent|immédiatement|suspendu|sera bloqué)/i,
  // Asks, not mentions: "buy 4 gift cards and send me the codes" is a
  // scam; "thank you for purchasing a gift card" is a receipt. Same for
  // crypto (an invitation to pay in bitcoin vs a talk about bitcoin) and
  // codes (asking for the code you received vs sending you a code).
  giftCard: /\b(buy|get|pick up|grab|acheter|achetez|achète)\b[^.]{0,30}(?<![$€£\d])\b(\d+|some|a few|several|two|three|four|five|des|quelques|deux|trois|quatre|cinq)\b[^.]{0,30}\bgift ?cards?|\b(send|text|read|give|share|email|tell)\b[^.]{0,40}\b(codes?|numbers?|photos?|pictures?)\b[^.]{0,30}\b(gift ?cards?|(the )?back of (the )?cards?|cartes? cadeaux?)\b|\bgift ?cards?\b[^.]{0,40}\b(send|text|read|scratch)\b[^.]{0,30}\b(codes?|numbers?)|\b(scratch|gratt\w*)\b[^.]{0,30}\b(card|carte|code)|\bcartes? cadeaux?\b[^.]{0,60}\b(envoy\w*|photo|codes?)|\b(transcash|pcs coupon|neosurf)\b/i,
  crypto: /\b(send|pay|deposit|transfer|invest|buy|withdraw|put)\b[^.]{0,40}\b(bitcoins?|crypto\w*|btc|usdt|ethereum)\b|\b(bitcoin|crypto)\s?(atm|kiosk|machine|wallet|address)\b|\b(envoy\w*|pay\w*|investi\w*|dépos\w*|retir\w*|achet\w*)\b[^.]{0,40}\b(bitcoins?|cryptos?\w*)\b/i,
  // A verification code, not "send the code" between developers.
  codeAsk: /\b(send|give|read|tell|share|forward|reply with|text|provide)\b[^.]{0,40}\b(verification|security|one-time|login|sign-in|confirmation|access|activation|\d-digit|six-digit|sms|text(ed)?|whatsapp)\s?(code|pin|otp)\b|\b(send|give|read|tell|share|forward|reply with|text|provide)\b[^.]{0,30}\b(the |this |that |your )?(pin|otp)\b|\b(code|otp|pin)\b[^.]{0,40}\b(you (just )?(received|got)|sent to your (phone|number)|we (just )?sent you)\b|\b(envoy\w*|donn\w*|communiqu\w*|transmett\w*|renvoy\w*|dict\w*)\b[^.]{0,30}\b(le |ce |votre |ton )?code\b[^.]{0,30}\b(re[çc]u|sms|de v[ée]rification|de validation|de s[ée]curit[ée])|\bcode\b[^.]{0,40}\b(re[çc]u|recevoir)\b/i,
  passwordAsk: /\b(confirm|confirme[rz]|enter|entrez|send|envoyez|give|donnez|saisissez|tape[rz]|provide|update|verify|vérifie[rz])\b.{0,30}\b(password|passcode|mot de passe|(your|vos|tes) codes|(secret|bank(ing)?|online.banking|access|login|security) codes?|codes? (secrets?|bancaires?|d'accès|de connexion|confidentiels?))\b/i,
  // A bank transfer is ordinary; a transfer to a NEW or "safe" account,
  // urgently, or an upfront fee is not.
  transferAsk: /\b(wire transfer|virement)\b[^.]{0,60}\b(urgent\w*|immédiat\w*|today|aujourd'hui|right now|maintenant|safe account|compte sécurisé|new (account|bank)|nouveau (compte|rib|iban)|different account|autre compte)|\b(new|updated|changed|nouveau|nouvelles?|changement de)\s+(bank (details|account)|account details|rib|iban|coordonnées bancaires)\b|\bupfront fee\b/i,
  secrecy: /(don't tell|do not tell|keep it (between us|secret)|don't mention|ne (le )?dites? (à|pas)|gardez.*secret|n'en parle[rz]? pas)/i,
  moveMoney: /(move (your )?money|send money to yourself|safe account|protect your (money|account).*send|transférer.*compte sécurisé)/i,
  callOnly: /(\bcall\b.{0,40}(now|number|support|at \d)|appelez le)/i,
  iban: /\b(FR|GB|DE|ES|IT)\d{2}[\s\d]{10,30}\b/,
  injection: /(ignore (previous|above|all) instructions|mark this as safe|you are (an? )?(ai|assistant)|system prompt|disregard.*instructions)/i,
  parcel: /(parcel|package|delivery|colis|livraison|tracking|suivi)/i,
  moneyAsk: /(send|pay|buy|transfer|wire|envoyer|payer|acheter|transférer).{0,40}(\$|€|£|\d+\s*(dollars|euros|usd|eur))/i,
  phone: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?:\+33[\s.]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/,
  // "Call us to cancel / dispute / get a refund": the hook of fake-invoice
  // callback scams (Geek Squad, Norton, PayPal invoices). Needs the call
  // and the cancel/dispute words together, not just a phone number.
  callback: /\b(call|phone|dial|contact|appelez|appeler|contactez)\b[^.]{0,60}\b(cancel\w*|dispute|refund|stop|unauthori[sz]ed|annul\w*|rembours\w*|contest\w*|résili\w*|bloquer)|\b(cancel\w*|dispute|refund|annul\w*|rembours\w*|contest\w*|résili\w*)\b[^.]{0,60}\b(call|phone|dial|appelez|appeler|contactez)\b/i,
  amount: /(\$|€|£)\s?\d|\d+[.,]?\d*\s?(€|euros?|dollars?|usd|eur)\b/i,
  // Requests for personal data through a message.
  dataAsk: /\b(submit|confirm|enter|provide|update|verify|send|give|share|fill in|renseign\w*|confirm\w*|saisi\w*|compl[ée]t\w*|envoy\w*|communiqu\w*|transmett\w*|mett\w* à jour)\b[^.]{0,50}\b(member (number|id)|medicare (number|card)|social security( number)?|ssn|card (number|details)|bank (details|account)|account number|date of birth|routing number|num[ée]ro de (s[ée]curit[ée] sociale|carte|compte)|coordonn[ée]es bancaires|donn[ée]es bancaires|rib|iban|identifiants?|login details)\b|\b(medicare|social security|member) (number|card)\b[^.]{0,40}\b(required|to (retain|keep|continue))/i,
  // "Mamie, my phone broke, can you pay…": family + trouble + money.
  family: /\b(mamie|mamy|papi|papy|grand-?m[eè]re|grand-?p[eè]re|maman|papa|mum|mom|mommy|dad|daddy|grandma|grandpa|granny|nana)\b/i,
  trouble: /(t[ée]l[ée]phone (est )?cass[ée]|cass[ée] mon t[ée]l[ée]phone|perdu mon t[ée]l[ée]phone|nouveau num[ée]ro|chang[ée] de num[ée]ro|accident|h[ôo]pital|hospital|prison|jail|\bbail\b|police|in trouble|lost my phone|broken phone|new number|changed my number)/i,
  familyMoney: /\b(send|pay|wire|transfer|lend|cover|envoyer|envoie|payer|paie|r[ée]gler|virer|vire|transf[ée]rer|pr[êe]ter|avancer)\b[^.?!]{0,50}(\$|€|£|\d+\s*(dollars?|euros?|usd|eur|€))/i,
  toll: /\b(unpaid toll|toll (balance|due|bill|charges?|notice|violation|invoice)|toll services?|road services?|p[ée]age (impay[ée]|non r[ée]gl[ée])|frais de p[ée]age)\b/i,
  parcelFee: /\b(parcel|package|colis|livraison|delivery|shipment)\b[^.]{0,80}\b(pay|payer|r[ée]glez|r[ée]gler|fee|frais)\b[^.]{0,40}((\$|€|£)\s?\d|\d+[.,]?\d*\s?(€|euros?|\$))/i,
  refund: /\b(remboursement|rembourser|avoir|trop[- ]per[çc]u|refund|you are (owed|eligible for)|unclaimed)\b[^.]{0,80}((\$|€|£)\s?\d|\d+[.,]?\d*\s?(€|euros?|dollars?))/i,
  fillIn: /\b(compl[ée]t\w*|confirm\w*|renseign\w*|saisi\w*|claim|r[ée]clam\w*|submit|enter|fill in|cliquez|click|dossier|form(ulaire)?)\b/i,
  // Advance-fee fraud ("419"): a windfall or secret deal, for your
  // details or a fee. Needs a large sum AND a windfall/deal AND an ask or
  // an official-sounding sender: football "transfer fees" do not qualify.
  bigMoney: /(\$|us\$|usd|€|£|eur|gbp)\s?\d{1,3}([,. ]\d{3}){2,}|\b\d+([.,]\d+)?\s?(million|billion|m\b|millions?|milliards?)\s*(of |de )?(us |u\.s\. )?(dollars?|euros?|pounds?|usd|eur|\$|€|£)?/i,
  windfall: /\b(next of kin|beneficiar(y|ies)|inheritance|h[ée]ritage|legs\b|deceased|late (husband|wife|father|client|mr|mrs)|d[ée]funt|lottery|loterie|jackpot|you (have )?won|vous avez gagn[ée]|winning (number|notification)|compensation (fund|payment)|unclaimed (fund|deposit|money)|dormant account|consignment|atm card|bank draft|fund(s)? (transfer|release)|transfer (the |this )?(fund|sum|money))\b/i,
  proposal: /\b(business (proposal|transaction|partner(ship)?|relationship|assistance|venture)|strict(est)? confidence|(private|strictly) (and )?confidential|confidential (business|transaction)|proposition (commerciale|d'affaires)|partenariat (strictement )?confidentiel)\b/i,
  detailsOrFee: /\b(send|provide|forward|reply with|furnish|envoy\w*|transmett\w*)\b[^.]{0,60}\b(full names?|your names?|address|phone|telephone|mobile|bank (details|account)|account (details|number)|passport|identification|id card|coordonn[ée]es|num[ée]ro de compte)\b|\b(processing|clearance|administrative|legal|release|handling|delivery|courier|registration) (fee|charge|cost)s?\b|\bfrais (de dossier|administratifs|de lib[ée]ration|de livraison|d'enregistrement)\b/i,
  officialRole: /\b(barrister|attorney|solicitor|diplomat|bank manager|auditor|director of|minister|prince|princess|widow|general|colonel|notaire|avocat|directeur|united nations|federal reserve|central bank|banque centrale)\b/i,
  // "Your mailbox will be closed / is full": phishing that poses as your
  // own email provider or IT department, no brand needed.
  accountThreat: /\b(mailbox|e-?mail (account|box)|webmail|inbox|storage|quota|account|compte|messagerie|bo[iî]te (mail|aux lettres))\b[^.!]{0,60}\b(full|almost full|exceeded|over (its )?limit|suspend\w*|deactivat\w*|de-?activat\w*|disabled|terminated|closed|blocked|locked|on hold|expir\w*|d[ée]sactiv\w*|suspendu\w*|bloqu\w*|ferm[ée]\w*|satur[ée]\w*)/i,
  accountVerify: /\b(verify|validate|confirm|re-?activate|upgrade|unlock|restore|v[ée]rifi\w*|valid\w*|confirm\w*|r[ée]activ\w*|d[ée]bloqu\w*)\b[^.!]{0,30}\b(your |votre )?(e-?mail|mailbox|webmail|account|compte|messagerie)\b/i,
  cta: /\b(click|cliquez|link|lien|here|ici|below|ci-dessous|button|bouton|log ?in|sign ?in|connect\w*|reply|r[ée]pond\w*)\b|https?:\/\//i,
  qrAsk: /\b(scan|scannez|scanner|flash(ez)?)\b[^.]{0,40}\b(qr|code|square image|image|carr[ée])\b/i,
};
// Servers that send genuine account notices for the big mail providers.
const MAIL_NOTIFIERS = ["google.com", "microsoft.com", "apple.com", "yahoo-inc.com", "orange.com", "proton.me"];
const RISKY_ATTACHMENT = /\.(html?|shtml|xhtml|svg|hta|js|vbs|wsf|iso|img)$/i;
// A link that asks you to let an app read your mailbox (consent phishing).
const MAILBOX_CONSENT = /(accounts\.google\.com\/(o\/oauth2|signin\/oauth)|login\.microsoftonline\.com\/[^?]*oauth2)[^ ]*scope=[^ ]*(mail\.google\.com|gmail|mail\.read|mail\.readwrite|offline_access)/i;

function parseAuth(message) {
  if (message.auth && typeof message.auth === "object") return message.auth;
  const s = String(message.auth || "").toLowerCase();
  const get = (k) => (s.includes(`${k}=pass`) || s.includes(`${k}: pass`) ? "pass" : s.includes(`${k}=fail`) || s.includes(`${k}=softfail`) || s.includes(`${k}: fail`) ? "fail" : "none");
  return { spf: get("spf"), dkim: get("dkim"), dmarc: get("dmarc") };
}
export const authPassed = (a) => (a.spf === "pass" || a.dkim === "pass") && a.spf !== "fail" && a.dkim !== "fail" && a.dmarc !== "fail";
export const authFailed = (a) => a.spf === "fail" || a.dkim === "fail" || a.dmarc === "fail";

const CARRIERS = ["Chronopost", "USPS", "FedEx", "UPS", "Colissimo", "Amazon Logistics", "DHL"];

export function detect(input) {
  const { message, patternCards = [], threadHistory = [], mockLinkInspection = {} } = input;
  const ctx = input.personalContext || {};
  const locale = input.locale || message.locale || "en-US";
  const fr = locale.toLowerCase().startsWith("fr");
  const L = (en, f) => (fr ? f : en);
  const text = `${message.fromName || ""} ${message.subject || ""} ${message.body || ""}`;
  const lower = text.toLowerCase();
  // Asks are judged on non-negated sentences only: a real bank saying
  // "we will NEVER ask for your codes" is a warning, not a request.
  const askText = text.split(/(?<=[.!?])\s+/).filter((s) => !/(never|jamais|do not ever|ne communiquez)/i.test(s)).join(" ");
  const fromDomain = domainOf(message.from || "");
  const replyDomain = domainOf(message.replyTo || "");
  const auth = parseAuth(message);
  // Who does it claim to be? An email claims an identity in its display
  // name; a text or screenshot has none, so its opening words ("USPS: …")
  // are the claim. A brand named only in the subject of an authenticated
  // email is a mention (a Best Buy advert for Apple AirPods), not a claim.
  const isEmail = (message.channel || "email") === "email";
  const nameClaims = claimedBrands(isEmail ? message.fromName || ""
    : `${message.fromName || ""} ${message.subject || ""} ${String(message.body || "").slice(0, 160)}`, message.claimedBrand || "");
  const subjectClaims = isEmail ? claimedBrands(message.subject || "") : [];
  let brand = brandByName(message.claimedBrand) || nameClaims[0] || null;
  let mentionedBrand = null;
  // Unauthenticated, a brand in the subject is a claim only when the
  // subject speaks AS the brand ("Your PayPal account…", "Chase: alert");
  // news and newsletters that talk ABOUT a brand stay mentions.
  const speaksAs = (b) => new RegExp(`^\\W*${b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–|]`, "i").test(message.subject || "")
    || /\b(your|votre|ton|vos)\s+(\S+\s+){0,2}(account|compte|card|carte|statement|relev[ée]|order|commande|package|parcel|colis|delivery|livraison|subscription|abonnement|payment|paiement|invoice|facture|refund|remboursement|id|password|mot de passe)\b|\b(security alert|unusual|suspend\w*|verify|v[ée]rifi\w*|confirm\w*|locked|bloqu\w*|action required|update required|alerte|s[ée]curit[ée]|important notice)\b/i.test(message.subject || "");
  if (!brand && subjectClaims.length) {
    if (authPassed(auth) || !speaksAs(subjectClaims[0])) mentionedBrand = subjectClaims[0];
    else brand = subjectClaims[0];
  }
  // A brand named only in the body is a mention too (never a claim): it
  // ties a borrowed link, a callback number or a data request to a brand.
  const bodyBrand = !brand && !mentionedBrand && isEmail ? claimedBrands(String(message.body || "").slice(0, 400))[0] || null : null;
  const topicBrand = mentionedBrand || bodyBrand;
  const inspections = inspectLinks(message, mockLinkInspection);
  const signals = [];
  // Reasons stay within the verdict schema whatever the input: a 70-letter
  // phishing address must never make the check itself fail.
  const clamp = (t) => (t.length > 200 ? `${t.slice(0, 197)}…` : t);
  const add = (points, evidence, en, f, strong = false) => signals.push({ points, evidence, text: clamp(L(en, f)), strong });

  // --- Rule 0: instructions inside the message are a scam signal ---
  if (RE.injection.test(text)) add(40, "sender", "This message tries to give orders to the safety checker itself.", "Ce message essaie de donner des ordres au vérificateur lui-même.", true);

  // --- Who claims to be whom ---
  const senderIsBrand = brand ? belongsTo(fromDomain, brand) : false;
  const provider = brand ? providerFor(ctx, brand.name) : null;
  // History means THIS person's history (a provider learned from their own
  // mail), never just "the address is the brand's official domain": a real
  // PayPal or a hacked brand account can still carry a scam.
  const senderMatchesHistory = Boolean(brand && provider?.realDomains?.length
    && provider.realDomains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`)));
  let impersonation = false;
  if (brand && fromDomain && !senderIsBrand) {
    impersonation = true;
    add(35, "sender",
      `It says it is ${brand.name}, but the sender's website address is ${fromDomain}, not ${brand.domains[0]}.`,
      `Il se dit ${brand.name}, mais l'adresse d'envoi est ${fromDomain}, pas ${brand.domains[0]}.`, true);
  }
  if (brand && lookalikeOf(message.fromName || "", brand)) {
    impersonation = true;
    add(30, "sender",
      `The sender's name "${message.fromName}" imitates ${brand.name} with look-alike letters. Real companies never do that.`,
      `Le nom de l'expéditeur « ${message.fromName} » imite ${brand.name} avec des lettres qui se ressemblent. Une vraie entreprise ne fait jamais cela.`, true);
  }
  const registrable = fromDomain.split(".").slice(-2).join(".");
  if (brand && fromDomain && !senderIsBrand && FREEMAIL.includes(registrable)) {
    impersonation = true;
    add(25, "sender",
      `${brand.name} never writes from a personal ${registrable} mailbox.`,
      `${brand.name} n'écrit jamais depuis une boîte personnelle ${registrable}.`, true);
  }
  const senderCountry = countryOf(fromDomain);
  const homeCountry = brandCountry(brand);
  if (brand && fromDomain && !senderIsBrand && senderCountry && homeCountry && senderCountry.code !== homeCountry) {
    add(15, "sender",
      `It was sent from an address in ${senderCountry.en} (${fromDomain}), which has nothing to do with ${brand.name}.`,
      `Il a été envoyé depuis une adresse au ${senderCountry.fr} (${fromDomain}), sans rapport avec ${brand.name}.`, true);
  }
  if (brand && authFailed(auth)) {
    impersonation = true;
    add(25, "auth", `It was not sent by ${brand.name}'s own servers.`, `Il n'a pas été envoyé par les serveurs officiels de ${brand.name}.`, true);
  }
  if (mentionedBrand && fromDomain && !belongsTo(fromDomain, mentionedBrand)) {
    add(10, "sender",
      `It talks about ${mentionedBrand.name} but was sent by ${fromDomain}. Adverts do that too, so check before acting.`,
      `Il parle de ${mentionedBrand.name} mais a été envoyé par ${fromDomain}. Les publicités le font aussi : vérifiez avant d'agir.`);
  }
  const replyBorrowed = replyDomain ? brandInDomain(replyDomain) : null;
  if (replyDomain && fromDomain && replyDomain !== fromDomain) {
    if (replyBorrowed) {
      impersonation = true;
      add(20, "sender",
        `Replies would go to ${replyDomain}, an address that borrows the name ${replyBorrowed.name} but is not ${replyBorrowed.name}.`,
        `Les réponses partiraient vers ${replyDomain}, une adresse qui emprunte le nom ${replyBorrowed.name} sans être ${replyBorrowed.name}.`, true);
    } else {
      add(15, "sender", "Replies would go to a different address than the sender's.", "Les réponses partiraient vers une autre adresse que celle de l'expéditeur.");
    }
  }

  // Xero, DocuSign, PayPal invoices, Google Calendar…: authentication proves
  // the platform, never the person who typed the text. Links back to the
  // platform itself (its footer, its invoice page) are expected.
  const platform = platformFor(message.from || "", `${message.subject || ""} ${message.body || ""}`);
  const onPlatform = (d) => Boolean(d) && (platform?.domains || []).some((pd) => sameOrSub(d, pd));

  // --- Links: judge the final landing place, not the shown text ---
  let linkNotBrand = false;
  let riskyLink = false;
  let listedLink = false;
  for (const ins of inspections) {
    const finalD = ins.finalDomain;
    // Only text that is itself a website address can lie about one: a label
    // like "Shop" or "Unsubscribe" is not a claim about the destination.
    const shownD = looksLikeAddress(ins.shownText) ? domainOf(ins.shownText) : "";
    if ((ctx.knownLinkDomains || []).includes(finalD)) continue;
    // www.example.com and example.com are the same website, not a trick.
    const bare = (d) => d.replace(/^www\./, "");
    if (shownD && finalD && bare(shownD) !== bare(finalD) && !finalD.endsWith(`.${bare(shownD)}`)) {
      linkNotBrand = true;
      // A pasted address that openly carries another one (a redirector,
      // Google Translate, a feed validator) is worth saying, but it is not a
      // disguise by itself: what it leads to decides (free hosting, brand…).
      if (ins.redirects.length && ins.startDomain === shownD) {
        add(15, "link", `The link passes through ${ins.startDomain} but really leads to ${finalD}.`, `Le lien passe par ${ins.startDomain} mais mène en réalité vers ${finalD}.`);
      } else {
        add(30, "link", `The button shows "${ins.shownText}" but really leads to ${finalD}.`, `Le bouton affiche « ${ins.shownText} » mais mène en réalité vers ${finalD}.`, true);
      }
    }
    // An address that wears a brand's name (adecco-hrjobs.com,
    // usps-redeliver.top) is a disguise when the message speaks for or
    // about that brand.
    const borrowed = finalD ? brandInDomain(finalD) : null;
    if (borrowed && (borrowed === brand || borrowed === mentionedBrand || mentions(text, borrowed.name))) {
      linkNotBrand = true;
      if (borrowed === brand || borrowed === topicBrand) impersonation = true;
      add(25, "link",
        `The link goes to ${finalD}, an address that borrows the name ${borrowed.name} but is not ${borrowed.name}'s website.`,
        `Le lien mène vers ${finalD}, une adresse qui emprunte le nom ${borrowed.name} sans être le site de ${borrowed.name}.`, true);
    } else if (brand && finalD && !belongsTo(finalD, brand) && !onPlatform(finalD) && !(ctx.knownLinkDomains || []).includes(finalD)
      && !(brand.linksAnywhere && senderIsBrand) && !(brand.runsHosting || []).some((s) => finalD.endsWith(s))) {
      linkNotBrand = true;
      add(25, "link", `The link leads to ${finalD}, which is not ${brand.name}'s website address.`, `Le lien mène vers ${finalD}, qui n'est pas l'adresse du site de ${brand.name}.`, true);
    }
    if (ins.domainAgeDays !== null && ins.domainAgeDays < 30) {
      add(20, "link_inspection",
        ins.domainAgeDays === 0 ? "The website behind the link was created the same day this message was sent." : `The website behind the link was created only ${ins.domainAgeDays} days before this message was sent.`,
        ins.domainAgeDays === 0 ? "Le site derrière le lien a été créé le jour même de l'envoi de ce message." : `Le site derrière le lien a été créé seulement ${ins.domainAgeDays} jours avant l'envoi de ce message.`, true);
    }
    // A brand writing from its own address may link to a blog it runs
    // (Google → blogspot) or to anyone's page (Google Alerts); a stranger
    // using the brand's name and a free page is the classic trap.
    const runsHost = (brand?.runsHosting || []).some((s) => finalD.endsWith(s));
    if (ins.isFreeHosting && brand && !runsHost && senderIsBrand) add(12, "link_inspection", "The link opens a page on a free website service.", "Le lien ouvre une page sur un service gratuit de création de sites.");
    else if (ins.isFreeHosting && brand && !runsHost) add(28, "link_inspection", "The page sits on a free website-builder address, which real companies never use.", "La page est hébergée sur une adresse gratuite de création de sites, ce qu'une vraie entreprise n'utilise jamais.", true);
    if (ins.pageShows && /(cop(y|ie)|clone|fake|faux|fausse).{0,60}(login|connexion|banque|bank)|(demande|asks for).{0,30}(codes|card)/i.test(ins.pageShows)) {
      add(20, "link_inspection", "The page behind the link copies a login page and asks for secret codes.", "La page derrière le lien copie une page de connexion et demande des codes secrets.", true);
    }
    if (ins.deadLink) add(10, "link_inspection", "One link in this message leads to a website address that no longer answers. Do not rely on it; open the official app yourself.", "Un lien de ce message mène vers une adresse qui ne répond plus. Ouvrez vous-même l'application officielle.");
    if (ins.isShortener) add(10, "link", "The link is shortened, so its real destination is hidden.", "Le lien est raccourci : sa vraie destination est cachée.");
    // --- What the address itself gives away (no brand claim needed) ---
    const onBrand = brand && belongsTo(finalD, brand);
    const shown = finalD.length > 40 ? `…${finalD.slice(-38)}` : finalD;
    if (ins.typosquat && !onBrand) {
      riskyLink = true;
      add(30, "link", `The link goes to ${shown}, a misspelling of ${ins.typosquat}'s address.`, `Le lien mène vers ${shown}, une adresse qui imite celle de ${ins.typosquat} avec une faute.`, true);
    }
    const throwaway = ins.isFreeHosting || ins.numericHost || ins.riskyTld;
    if (ins.borrowedBrand && !onBrand && throwaway && !linkNotBrand) {
      riskyLink = true;
      add(25, "link", `The link uses the name ${ins.borrowedBrand} on ${shown}, a site that is not ${ins.borrowedBrand}'s.`, `Le lien utilise le nom ${ins.borrowedBrand} sur ${shown}, un site qui n'est pas celui de ${ins.borrowedBrand}.`, true);
    }
    if (!brand && ins.isFreeHosting && (ins.credentialWords || ins.machineName || ins.borrowedBrand)) {
      riskyLink = true;
      add(25, "link_inspection", `The link opens a page on a free website service (${shown}). Anyone can publish one in minutes; real companies do not put their sign-in pages there.`,
        `Le lien ouvre une page sur un service gratuit de création de sites (${shown}). N'importe qui peut en publier une en quelques minutes ; les vraies entreprises n'y mettent pas leurs pages de connexion.`, true);
    } else if (!brand && ins.isFreeHosting) {
      add(12, "link_inspection", `The link opens a page on a free website service (${shown}).`, `Le lien ouvre une page sur un service gratuit de création de sites (${shown}).`);
    }
    if (ins.numericHost) {
      if (ins.credentialWords || ins.machineName) riskyLink = true;
      add(15, "link", `The link goes to ${shown}, an address made only of numbers.`, `Le lien mène vers ${shown}, une adresse faite uniquement de chiffres.`, Boolean(ins.credentialWords));
    }
    if (ins.riskyTld && !ins.isFreeHosting && (ins.credentialWords || ins.borrowedBrand)) {
      riskyLink = true;
      add(15, "link", `The link goes to ${shown}, on an address ending often used for short-lived scam sites.`, `Le lien mène vers ${shown}, une terminaison d'adresse souvent utilisée pour des sites d'arnaque éphémères.`, true);
    }
    if (ins.emailInFragment || (ins.emailInUrl && throwaway && !onBrand)) {
      riskyLink = true;
      add(20, "link", "The link carries an email address inside it: it was made for one person, a sign of a targeted trap.", "Le lien contient une adresse e-mail : il a été fabriqué pour une personne précise, signe d'un piège ciblé.", true);
    }
    // A public blocklist names this link or its website (abuse.ch URLhaus,
    // with Spamhaus DBL). It outranks a known sender: accounts get hacked.
    const uh = ins.urlhaus;
    if (uh && (uh.exact || uh.hostBad)) {
      listedLink = riskyLink = true;
      if (uh.exact) add(45, "link_inspection", `This exact link is on abuse.ch's URLhaus list of links that spread harmful software${uh.online ? ", and it was still active when checked" : ""}.`,
        `Ce lien précis figure sur la liste URLhaus d'abuse.ch des liens qui diffusent des logiciels malveillants${uh.online ? ", et il était encore actif lors de la vérification" : ""}.`, true);
      else if (uh.phishing) add(45, "link_inspection", `Spamhaus lists ${shown} as a phishing website (reported through abuse.ch URLhaus).`, `Spamhaus classe ${shown} comme site d'hameçonnage (signalé via URLhaus d'abuse.ch).`, true);
      else add(40, "link_inspection", `${shown} is on abuse.ch's URLhaus list of websites that spread harmful software.`, `${shown} figure sur la liste URLhaus d'abuse.ch des sites qui diffusent des logiciels malveillants.`, true);
    }
    if (ins.isIpAddress) add(15, "link", "The link leads to a bare number address, not a company website.", "Le lien mène vers une adresse en chiffres, pas vers le site d'une entreprise.");
  }
  if (linkNotBrand) impersonation = true;

  // --- Mail carried by a platform on someone else's behalf ---
  const outsideLinks = platform ? inspections.filter((i) => i.finalDomain && !onPlatform(i.finalDomain)) : [];
  const callback = RE.phone.test(text) && RE.callback.test(askText) && RE.amount.test(text);
  const merchantContent = Boolean(platform && brand && senderIsBrand && platform.name === brand.name);
  if (platform && !merchantContent && !mentions(message.fromName || "", platform.name)
      && (outsideLinks.length || callback || RE.moneyAsk.test(askText))) {
    // Replies going to the business itself are normal for invoices; links
    // leading away from the platform, a callback number or a money ask are not.
    add(20, "sender",
      `It came through ${platform.name}'s ${platform.kind[0]} service, which anyone can use. ${platform.name} only carried it; the writer calls themselves "${message.fromName || "?"}".`,
      `Il est passé par le service ${platform.kind[1]} de ${platform.name}, que tout le monde peut utiliser. ${platform.name} n'a fait que le transmettre ; l'auteur se présente comme « ${message.fromName || "?"} ».`, true);
  }
  if (merchantContent && (callback || outsideLinks.length)) {
    add(20, "sender",
      `This really comes from ${brand.name}, but the text inside was written by whoever sent it. ${brand.name} does not check it.`,
      `Il vient bien de ${brand.name}, mais le texte a été écrit par l'expéditeur de la facture. ${brand.name} ne le vérifie pas.`, true);
  }
  if (callback) {
    add(25, "payment",
      "It asks you to call a phone number about a charge or a renewal. That is how fake invoices get you on the phone: find the real number on the company's own website.",
      "Il vous demande d'appeler un numéro au sujet d'un débit ou d'un renouvellement. C'est ainsi que les fausses factures vous font téléphoner : cherchez le vrai numéro sur le site officiel.", true);
    if ((brand && !senderIsBrand) || (topicBrand && !belongsTo(fromDomain, topicBrand)) || merchantContent || platform) impersonation = true;
  }

  // --- Personal context: does it fit her real life? ---
  const carrierMentioned = CARRIERS.find((c) => lower.includes(c.toLowerCase()));
  if (carrierMentioned && RE.parcel.test(text)) {
    const matches = matchingOrder(ctx, { carrier: carrierMentioned });
    const orders = ctx.orders || [];
    if (orders.length && !matches.length) {
      add(25, "personal_context",
        `Your real order is delivered by ${orders[0].carrier}, not ${carrierMentioned}. No ${carrierMentioned} delivery is coming.`,
        `Votre vraie commande est livrée par ${orders[0].carrier}, pas par ${carrierMentioned}. Aucune livraison ${carrierMentioned} n'arrive.`, true);
    }
  }
  if (brand && provider === null && (ctx.providers || []).length && /bill|invoice|debit|renewal|statement|facture|prélèvement|renouvellement/i.test(text)) {
    add(10, "personal_context", `${brand.name} is not one of your known providers.`, `${brand.name} ne fait pas partie de vos fournisseurs connus.`);
  }
  const subscriptionMention = (ctx.subscriptions || []).length >= 0 && /classplus|subscription|abonnement/i.test(text)
    ? text.match(/([A-Z][A-Za-z]+ ?(?:Pro|Plus|Premium))/)?.[1] : null;
  if (subscriptionMention && !(ctx.subscriptions || []).some((s) => s.toLowerCase().includes(subscriptionMention.toLowerCase()))) {
    add(15, "personal_context", `You have no subscription called ${subscriptionMention} in your emails.`, `Vous n'avez aucun abonnement nommé ${subscriptionMention} dans vos e-mails.`, true);
  }
  if (RE.iban.test(text) || /old password|ancien mot de passe/i.test(text)) {
    const kind = RE.iban.test(text) ? "IBAN" : "password";
    const breach = breachLeaking(ctx, kind);
    if (breach) {
      add(20, "breach",
        `That ${kind === "IBAN" ? "bank number" : "old password"} is real, but it leaked in the ${breach.source} breach (${breach.date}). Thieves use it to look credible.`,
        `Ce ${kind === "IBAN" ? "numéro de compte" : "ancien mot de passe"} est réel, mais il a fuité lors du piratage de ${breach.source} (${breach.date}). Les voleurs l'utilisent pour paraître crédibles.`, true);
    }
  }

  // --- Pressure, payment, asks ---
  const neverAsk = RE.giftCard.test(askText) || RE.crypto.test(askText) || RE.codeAsk.test(askText) || RE.passwordAsk.test(askText) || RE.moveMoney.test(askText) || RE.transferAsk.test(askText);
  if (RE.urgency.test(text)) add(12, "pressure", "It tries to rush you with a deadline or a threat.", "Il cherche à vous presser avec un délai ou une menace.");
  if (RE.giftCard.test(askText)) add(25, "payment", "It asks for gift cards, which real companies never accept as payment this way.", "Il demande des cartes cadeaux, qu'aucune vraie entreprise n'accepte ainsi.", true);
  if (RE.crypto.test(askText)) add(25, "payment", "It pushes you toward crypto, whose payments cannot be recovered.", "Il vous pousse vers les cryptomonnaies, dont les paiements sont irrécupérables.", true);
  if (RE.codeAsk.test(askText)) add(25, "payment", "It asks for a verification code. Never share a code someone asks for.", "Il demande un code de vérification. Ne partagez jamais un code qu'on vous réclame.", true);
  if (RE.passwordAsk.test(askText)) add(25, "payment", "It asks for passwords or secret codes, which no real company requests by message.", "Il demande des mots de passe ou des codes secrets, ce qu'aucune vraie entreprise ne fait par message.", true);
  if (RE.secrecy.test(text)) add(15, "pressure", "It asks you to keep this secret from family or your bank.", "Il vous demande de garder cela secret, loin de votre famille ou de votre banque.");
  if (RE.moveMoney.test(askText)) add(30, "payment", "It asks you to move money to protect it. Banks never ask that.", "Il vous demande de déplacer votre argent pour le protéger. Les banques ne demandent jamais cela.", true);

  if (!brand && authFailed(auth)) {
    add(15, "auth", "Technical checks on this message failed, so anyone could have sent it.", "Les vérifications techniques de ce message échouent : n'importe qui a pu l'envoyer.");
    if (RE.moneyAsk.test(text) || RE.callOnly.test(text)) impersonation = true;
  }
  if (brand && !senderIsBrand && ["Microsoft", "Apple"].includes(brand.name) && /call/i.test(text) && /warning|infected|security|alerte|infecté/i.test(text)) {
    impersonation = true;
    add(30, "sender", `${brand.name} never puts a phone number in a security warning. Close the window.`, `${brand.name} ne met jamais de numéro de téléphone dans une alerte de sécurité. Fermez la fenêtre.`, true);
  }

  // --- Trusted contact behaving out of character ---
  // contact: the message comes from a trusted person's saved address or
  // number. claimed: it only uses their name, from somewhere else.
  const contact = trustedContactFor(ctx, message.from);
  const claimed = claimedContactFor(ctx, message);
  const claimsNewNumber = /changed my number|new number|nouveau numéro|changé de numéro/i.test(text);
  const outOfCharacter = Boolean((contact && (neverAsk || RE.secrecy.test(askText) || RE.moneyAsk.test(askText) || (replyDomain && replyDomain !== fromDomain)))
    || (claimed && (neverAsk || RE.secrecy.test(text) || RE.moneyAsk.test(text) || claimsNewNumber)));
  if (contact && outOfCharacter) {
    add(20, "contact_history",
      `This is really ${contact.name}'s address, but ${contact.name} has never asked you for money or secrecy like this.`,
      `C'est bien l'adresse de ${contact.name}, mais ${contact.name} ne vous a jamais demandé d'argent ni de secret ainsi.`, true);
  } else if (claimed) {
    const byPhone = !/@/.test(message.from || "");
    const saved = byPhone ? (claimed.phone ? digits(claimed.phone).slice(-4) : null) : claimed.email || null;
    const what = byPhone ? "number" : "address";
    const quoi = byPhone ? "numéro" : "adresse";
    add(outOfCharacter ? 25 : 20, "contact_history",
      `It says it is ${claimed.name}, but it does not come from the ${what} you have for ${claimed.name}${saved ? (byPhone ? ` (ending in ${saved})` : ` (${saved})`) : ""}. Anyone can type a name.`,
      `Le message dit venir de ${claimed.name}, mais pas du ${quoi} que vous avez pour ${claimed.name}${saved ? (byPhone ? ` (finissant par ${saved})` : ` (${saved})`) : ""}. N'importe qui peut écrire un nom.`, true);
    // The model gets the fact, never the saved address or number.
    signals.at(-1).forModel = `It uses the name of a trusted ${claimed.relation || "person"} but does not come from the ${what} saved for them.`;
  }

  // --- Requests and lures that need no brand at all ---
  const dataAsk = RE.dataAsk.test(askText);
  if (dataAsk) {
    add(25, "payment",
      topicBrand || brand ? `It asks for personal details (card, account or member number) through a message. ${(brand || topicBrand).name} never asks for that this way.` : "It asks for personal details (card, account or member number) through a message. Real organisations never ask for that this way.",
      topicBrand || brand ? `Il demande des informations personnelles (numéro de carte, de compte ou d'assuré) par message. ${(brand || topicBrand).name} ne le demande jamais ainsi.` : "Il demande des informations personnelles (numéro de carte, de compte ou d'assuré) par message. Aucun organisme sérieux ne le demande ainsi.", true);
    if ((brand && !senderIsBrand) || (topicBrand && !belongsTo(fromDomain, topicBrand))) impersonation = true;
  }
  const familyEmergency = RE.family.test(text) && (RE.trouble.test(text) || RE.secrecy.test(text)) && RE.familyMoney.test(askText) && !contact;
  if (familyEmergency) {
    add(30, "contact_history",
      "Someone writing as family asks for money right away. Call them on the number you already have before sending anything.",
      "Quelqu'un qui se présente comme un proche vous demande de l'argent tout de suite. Appelez-le sur le numéro que vous connaissez avant d'envoyer quoi que ce soit.", true);
  }
  // Toll and parcel-fee texts are judged without a brand only off email
  // (or on unauthenticated email): real toll agencies and shops send
  // genuine bills by authenticated email.
  const offBrandLink = inspections.some((i) => i.finalDomain && !(brand && belongsTo(i.finalDomain, brand)) && !onPlatform(i.finalDomain)
    && !(ctx.knownLinkDomains || []).includes(i.finalDomain));
  const lureChannel = !isEmail || !authPassed(auth);
  if (lureChannel && offBrandLink && (RE.toll.test(text) || RE.parcelFee.test(text))) {
    impersonation = true;
    add(25, "pattern",
      RE.toll.test(text) ? "Unpaid-toll messages with a payment link are a well-known scam. Toll agencies do not collect by message link." : "Delivery-fee messages with a payment link are a well-known scam. Carriers do not collect fees this way.",
      RE.toll.test(text) ? "Les messages de péage impayé avec un lien de paiement sont une arnaque connue. Les sociétés d'autoroute n'encaissent pas par lien." : "Les messages de frais de livraison avec un lien de paiement sont une arnaque connue. Les transporteurs n'encaissent pas ainsi.", true);
  }
  if (RE.refund.test(text) && RE.fillIn.test(askText) && offBrandLink) {
    add(25, "payment",
      "It promises you money back, then asks you to fill in your details through a link. That is how refund scams collect bank details.",
      "Il vous promet un remboursement, puis vous demande de remplir vos informations via un lien. C'est ainsi que les faux remboursements récupèrent vos coordonnées bancaires.", true);
    if ((brand && !senderIsBrand) || (topicBrand && !belongsTo(fromDomain, topicBrand))) impersonation = true;
  }
  if (RE.qrAsk.test(askText)) {
    add(20, "link",
      "It asks you to scan a code. A code hides the website address, so nobody can check where it leads: open the company's site yourself.",
      "Il vous demande de scanner un code. Un code cache l'adresse du site, impossible de vérifier où il mène : ouvrez vous-même le site officiel.", true);
  }
  const oauthAsk = (message.links || []).some((l) => MAILBOX_CONSENT.test(l.href || ""));
  if (oauthAsk) {
    add(30, "link",
      "A link in it asks you to let an app read your mailbox. Never approve that from a message.",
      "Un lien vous demande d'autoriser une application à lire votre messagerie. N'acceptez jamais cela depuis un message.", true);
  }
  const riskyAttachment = (message.attachments || []).some((a) => RISKY_ATTACHMENT.test(a.filename || "") || /text\/html|image\/svg/i.test(a.mimeType || ""));
  if (riskyAttachment) {
    add(25, "link",
      "It comes with a web-page file attached (.html or .svg). Opening it can show a fake login page.",
      "Il contient une page web en pièce jointe (.html ou .svg). L'ouvrir peut afficher une fausse page de connexion.", true);
  }
  const feeHits = [RE.bigMoney, RE.windfall, RE.proposal, RE.detailsOrFee, RE.officialRole].filter((re) => re.test(text)).length;
  const advanceFee = !contact && RE.bigMoney.test(text) && (RE.windfall.test(text) || RE.proposal.test(text))
    && (RE.detailsOrFee.test(text) || RE.officialRole.test(text)) && feeHits >= 3;
  if (advanceFee) {
    add(35, "payment",
      "It offers you a large sum of money (an inheritance, a lottery win, a secret business deal) in exchange for your details or a fee. Real banks, lawyers and lotteries never contact you like this.",
      "Il vous promet une grosse somme d'argent (héritage, gain de loterie, affaire secrète) contre vos coordonnées ou des frais. Les vraies banques, notaires et loteries ne vous contactent jamais ainsi.", true);
  }
  // Mailbox/account threats. A genuine notice from the provider itself
  // (authenticated brand mail, or Google/Microsoft/Apple's own servers) is
  // left alone; a sign-up "verify your email" without a threat is too.
  const providerNotice = authPassed(auth) && (senderIsBrand || MAIL_NOTIFIERS.some((d) => sameOrSub(fromDomain, d)));
  const accountLure = !providerNotice && !contact && (RE.accountThreat.test(askText) || (RE.accountVerify.test(askText) && RE.urgency.test(text)));
  const linkAway = inspections.some((i) => i.finalDomain && i.finalDomain.split(".").slice(-2).join(".") !== fromDomain.split(".").slice(-2).join("."));
  const accountPhish = accountLure && RE.cta.test(askText) && (!authPassed(auth) || FREEMAIL.includes(registrable) || linkAway);
  if (accountLure) {
    add(25, "sender",
      "It threatens to close, block or limit your email or account unless you act through this message. Real providers never ask you to confirm your account this way.",
      "Il menace de fermer, bloquer ou limiter votre messagerie ou votre compte si vous n'agissez pas via ce message. Un vrai fournisseur ne vous demande jamais de confirmer votre compte ainsi.", true);
  }
  const forbiddenAsk = neverAsk || familyEmergency || oauthAsk || advanceFee || accountPhish;

  // A known contact's real address can be hacked: a link to a new or
  // free-hosted site, a borrowed brand address or a callback from them is
  // not "them writing normally".
  const contactRisky = Boolean(contact && !outOfCharacter && (linkNotBrand || callback || riskyAttachment || oauthAsk
    || signals.some((x) => x.strong && ["link", "link_inspection", "pattern"].includes(x.evidence))));
  if (contactRisky) {
    add(20, "contact_history",
      `This comes from ${contact.name}'s real address, but what it asks you to open is unusual for them. Their account may have been taken over: check with them by phone.`,
      `Il vient bien de l'adresse de ${contact.name}, mais ce qu'il vous demande d'ouvrir est inhabituel. Son compte a peut-être été piraté : vérifiez par téléphone.`, true);
  }

  // --- Thread direction (romance / slow-burn) ---
  const threadText = (threadHistory || []).map((m) => m.body || "").join(" ").toLowerCase();
  let threadEscalation = false;
  if (threadHistory.length >= 2 && /(love|beautiful|dear|chérie|mon amour)/i.test(threadText) && (RE.crypto.test(askText) || RE.moneyAsk.test(text))) {
    threadEscalation = true;
    add(25, "thread", "This conversation slowly moved from affection to money. That pattern is a known scam.", "Cette conversation est passée lentement des compliments à l'argent. C'est un schéma d'arnaque connu.", true);
  }

  // --- Pattern cards (candidate can only cap at be_careful) ---
  const matched = matchCards(message, patternCards);
  const matchedActive = matched.filter((c) => c.status === "active");
  const matchedCandidate = matched.filter((c) => c.status !== "active");
  if (matchedActive.length) add(20, "pattern", "This matches a scam campaign reported this week.", "Cela correspond à une arnaque signalée cette semaine.", true);
  if (matchedCandidate.length && !matchedActive.length) add(10, "pattern", "A similar scam has been reported, but it is not confirmed yet.", "Une arnaque semblable a été signalée, mais elle n'est pas encore confirmée.");

  if (brand && senderIsBrand && authPassed(auth) && /password|mot de passe|new device|nouvel appareil/i.test(text)) {
    add(5, "personal_context",
      `This really comes from ${brand.name} and says your password was changed. If that was not you, your account needs attention.`,
      `Ce message vient bien de ${brand.name} et dit que votre mot de passe a été changé. Si ce n'est pas vous, votre compte a besoin d'attention.`);
  }

  const score = signals.reduce((s, x) => s + x.points, 0);
  const reasons = [...signals].sort((a, b) => b.points - a.points).slice(0, 3)
    .map(({ text: t, evidence }) => ({ text: t, evidence }));

  // --- Safe guard: real sender, matches history, nothing risky ---
  const riskyAsk = neverAsk || RE.moveMoney.test(askText) || inspections.length > 0 && linkNotBrand;
  const authenticBrandMail = brand && senderIsBrand && authPassed(auth) && (senderMatchesHistory || provider || isKnownHistory(ctx, message))
    && !(merchantContent && (callback || outsideLinks.length));
  let verdict;
  if (outOfCharacter || contactRisky) verdict = "be_careful";
  else if (authenticBrandMail && !forbiddenAsk && !linkNotBrand && !riskyAttachment && !dataAsk) {
    verdict = /new device|security alert|nouvel appareil|alerte|password (changed|updated)|mot de passe (enregistré|modifié|changé)|modification de votre mot de passe|sécuriser/i.test(text) ? "be_careful" : "safe";
  } else if (contact && !outOfCharacter) verdict = "safe";
  else if ((impersonation && (inspections.length || forbiddenAsk || callback || dataAsk || riskyAttachment || RE.callOnly.test(text) || RE.moneyAsk.test(text)))
    || (forbiddenAsk && !contact) || (riskyLink && !contact) || matchedActive.length && score >= 40) verdict = "scam";
  else if (score >= 55 && impersonation) verdict = "scam";
  else if (score >= 18 || matchedCandidate.length || threadEscalation) verdict = "be_careful";
  else verdict = "safe";
  if (matchedCandidate.length && !matchedActive.length && verdict === "scam" && !impersonation && !neverAsk) verdict = "be_careful";
  if (listedLink) verdict = "scam";
  if (threadEscalation && verdict === "safe") verdict = "be_careful";
  // A slow-burn thread alone proves a direction, not yet a completed scam.
  if (threadEscalation && !impersonation && verdict === "scam") verdict = "be_careful";

  const confidence = verdict === "scam" ? Math.min(0.97, 0.75 + score / 200)
    : verdict === "safe" ? (authenticBrandMail || contact ? 0.9 : 0.72)
    : Math.min(0.9, 0.6 + score / 150);

  const headline = verdict === "scam" ? L("Scam: do not click, pay, or reply to this.", "Arnaque : ne cliquez pas, ne payez rien, ne répondez pas.")
    : verdict === "be_careful" ? L("Be careful: check this before you do anything.", "Attention : vérifiez avant de faire quoi que ce soit.")
    : L("Safe: this looks like a genuine message.", "Rassurez-vous : ce message semble authentique.");

  const scamType = scamTypeFor({ brand, text, contact, claimed, threadEscalation, channel: message.channel });
  const action = pickAction({ verdict, contact, outOfCharacter, brand, threadEscalation, fr });
  const involvesMoney = neverAsk || RE.moneyAsk.test(text) || /(€|\$|£)\s?\d|\d+[.,]?\d*\s?(€|euros?|dollars?|usd|eur)/i.test(text);
  const escalate = verdict !== "safe" && (involvesMoney || RE.secrecy.test(text) || outOfCharacter || /threat|arrest|menace/i.test(text));
  const topWhy = reasons.map((r) => r.text).join(" ");

  const out = {
    verdict, confidence: Math.round(confidence * 100) / 100, headline,
    reasons: reasons.length ? reasons : [{ text: L("The sender, the links and the wording all match what we expect.", "L'expéditeur, les liens et le contenu correspondent à ce que nous attendons."), evidence: "personal_context" }],
    action: action.action, action_text: action.text,
    real_company_says: verdict !== "safe" && brand?.never ? brand.never : null,
    impersonated_brand: verdict !== "safe" && brand && !senderIsBrand ? brand.name : null,
    scam_type: verdict === "safe" || authenticBrandMail ? null : scamType,
    matched_pattern_ids: matched.map((c) => c.id),
    escalate_to_guardian: Boolean(escalate),
    guardian_summary: verdict === "safe" ? null : L(
      `Scam Shield flagged a message for your relative (${verdict === "scam" ? "likely scam" : "needs care"}). ${topWhy} No action has been taken on it yet.`,
      `Scam Shield a signalé un message reçu par votre proche (${verdict === "scam" ? "arnaque probable" : "à vérifier"}). ${topWhy} Aucune action n'a encore été faite.`),
    language: fr ? "fr" : "en",
  };
  const errs = validateVerdict(out);
  if (errs.length) throw new Error(`detector produced invalid verdict: ${errs.join("; ")}`);
  // _authentic: the sender provably is who it claims and fits this user's
  // history. Muse Spark may soften such a verdict, never turn it into scam.
  const authentic = Boolean((authenticBrandMail && !forbiddenAsk && !linkNotBrand && !dataAsk) || (contact && !outOfCharacter && !contactRisky));
  return { ...out, _score: score, _signals: signals, _authentic: authentic };
}

function looksLikeAddress(text) {
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(String(text || "").trim());
}

function isKnownHistory(ctx, message) {
  return (ctx.knownSenders || []).some((s) => s.email?.toLowerCase() === String(message.from || "").toLowerCase());
}

function scamTypeFor({ brand, text, contact, claimed, threadEscalation }) {
  if (contact) return "account_takeover_contact";
  if (claimed) return "voice_clone_family";
  if (threadEscalation) return "romance_investment";
  if (/webcam|filmed you| Sextortion|bitcoin.*48/i.test(text)) return "sextortion";
  if (/recover (your )?(lost )?money|law firm.*recover|fonds perdus/i.test(text)) return "recovery";
  if (RE.codeAsk.test(text)) return "code_theft";
  if (RE.transferAsk.test(text)) return "fake_invoice_or_renewal";
  if (/antivirus|microsoft|tech support|support number/i.test(text)) return "tech_support";
  if (brand && ["USPS", "Chronopost", "FedEx", "UPS"].includes(brand.name)) return "parcel";
  if (brand && brand.name === "E-ZPass") return "toll";
  if (brand && ["IRS", "Social Security", "Medicare", "ANTAI", "Ameli"].includes(brand.name)) return "government";
  if (brand && ["Chase", "Bank of America", "Wells Fargo", "Société Générale", "PayPal"].includes(brand.name)) return "bank";
  if (/invoice|renewal|debit|facture|prélèvement/i.test(text)) return "fake_invoice_or_renewal";
  return brand ? "impersonation" : "other";
}

function pickAction({ verdict, contact, outOfCharacter, brand, threadEscalation, fr }) {
  const L = (en, f) => (fr ? f : en);
  if (verdict === "safe") return { action: "do_nothing", text: L("You do not need to do anything.", "Vous n'avez rien à faire.") };
  if (outOfCharacter || contact) return { action: "verify_with_real_person", text: L("Call them on the number you already have before doing anything.", "Appelez cette personne au numéro que vous avez déjà avant de faire quoi que ce soit.") };
  if (threadEscalation) return { action: "ask_guardian", text: L("Show this conversation to a person you trust before replying.", "Montrez cette conversation à une personne de confiance avant de répondre.") };
  if (brand && ["Chase", "Bank of America", "Wells Fargo", "Société Générale", "Social Security", "Medicare", "IRS"].includes(brand.name)) {
    return { action: "call_official_number", text: L("Delete it. If worried, call the number on your card or statement.", "Supprimez-le. En cas de doute, appelez le numéro au dos de votre carte.") };
  }
  if (verdict === "scam") return { action: "delete", text: L("Delete this message. Do not click, pay, call, or reply.", "Supprimez ce message. Ne cliquez pas, ne payez rien, n'appelez pas, ne répondez pas.") };
  return { action: "check_official_website", text: L("Do not use the link here. Open the company's own app or website yourself.", "N'utilisez pas le lien ici. Ouvrez vous-même l'application ou le site officiel.") };
}
