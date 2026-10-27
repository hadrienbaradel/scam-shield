// Scam Shield detector: cheap deterministic pass over personal context,
// auth, links, pattern cards and thread history. This is the fallback and
// the evidence-gatherer; Muse Spark (lib/muse.js) may rewrite wording,
// but it receives these facts and the same schema. PRD rules live here:
// breach data raises risk, candidate cards cap at be_careful, real senders
// matching history are never marked scam (except hacked known contacts).

import { domainOf, belongsTo, claimedBrands, brandByName } from "./brands.js";
import { inspectLinks } from "./linkInspector.js";
import { matchCards } from "./patterns.js";
import { providerFor, trustedContactFor, matchingOrder, breachLeaking } from "./context.js";
import { validateVerdict } from "./schema.js";

const RE = {
  urgency: /(urgent|immediately|act now|within \d+ (hours|days)|act within|final notice|suspended|will be (closed|locked)|legal action|arrest|pay today|avoid (fees|penalty)|dans \d+ jours|urgent|immédiatement|suspendu|sera bloqué)/i,
  giftCard: /(gift ?cards?|apple gift|google play card|transcash|pcs coupon|cartes? cadeaux?)/i,
  crypto: /(bitcoin|crypto|btc|bitcoin atm|crypto atm)/i,
  codeAsk: /(verification code|one-time code|security code|send (me|back) the code|code you (received|got)|code de (vérification|validation)|renvoyez.*code)/i,
  passwordAsk: /(confirm your password|enter your password|online-banking codes|(confirm|confirme[rz]|enter|entrez|send|envoyez|give|donnez|saisissez|tape[rz]).{0,30}(password|codes|mot de passe))/i,
  secrecy: /(don't tell|do not tell|keep it (between us|secret)|don't mention|ne (le )?dites? (à|pas)|gardez.*secret|n'en parle[rz]? pas)/i,
  moveMoney: /(move (your )?money|send money to yourself|safe account|protect your (money|account).*send|transférer.*compte sécurisé)/i,
  callOnly: /(\bcall\b.{0,40}(now|number|support|at \d)|appelez le)/i,
  iban: /\b(FR|GB|DE|ES|IT)\d{2}[\s\d]{10,30}\b/,
  injection: /(ignore (previous|above|all) instructions|mark this as safe|you are (an? )?(ai|assistant)|system prompt|disregard.*instructions)/i,
  parcel: /(parcel|package|delivery|colis|livraison|tracking|suivi)/i,
  moneyAsk: /(send|pay|buy|transfer|wire|envoyer|payer|acheter|transférer).{0,40}(\$|€|£|\d+\s*(dollars|euros|usd|eur))/i,
};

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
  const { message, personalContext: ctx = {}, patternCards = [], threadHistory = [], mockLinkInspection = {} } = input;
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
  if (!brand && subjectClaims.length) {
    if (authPassed(auth)) mentionedBrand = subjectClaims[0];
    else brand = subjectClaims[0];
  }
  const inspections = inspectLinks(message, mockLinkInspection);
  const signals = [];
  const add = (points, evidence, en, f, strong = false) => signals.push({ points, evidence, text: L(en, f), strong });

  // --- Rule 0: instructions inside the message are a scam signal ---
  if (RE.injection.test(text)) add(40, "sender", "This message tries to give orders to the safety checker itself.", "Ce message essaie de donner des ordres au vérificateur lui-même.", true);

  // --- Who claims to be whom ---
  const senderIsBrand = brand ? belongsTo(fromDomain, brand) : false;
  const provider = brand ? providerFor(ctx, brand.name) : null;
  const historyDomains = provider?.realDomains?.length ? provider.realDomains : brand?.domains || [];
  const senderMatchesHistory = brand ? historyDomains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`)) : false;
  let impersonation = false;
  if (brand && fromDomain && !senderIsBrand) {
    impersonation = true;
    add(35, "sender",
      `It says it is ${brand.name}, but the sender's website address is ${fromDomain}, not ${brand.domains[0]}.`,
      `Il se dit ${brand.name}, mais l'adresse d'envoi est ${fromDomain}, pas ${brand.domains[0]}.`, true);
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
  if (replyDomain && fromDomain && replyDomain !== fromDomain) {
    add(15, "sender", "Replies would go to a different address than the sender's.", "Les réponses partiraient vers une autre adresse que celle de l'expéditeur.");
  }

  // --- Links: judge the final landing place, not the shown text ---
  let linkNotBrand = false;
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
      add(30, "link", `The button shows "${ins.shownText}" but really leads to ${finalD}.`, `Le bouton affiche « ${ins.shownText} » mais mène en réalité vers ${finalD}.`, true);
    }
    if (brand && finalD && !belongsTo(finalD, brand) && !(ctx.knownLinkDomains || []).includes(finalD)) {
      linkNotBrand = true;
      add(25, "link", `The link leads to ${finalD}, which is not ${brand.name}'s website address.`, `Le lien mène vers ${finalD}, qui n'est pas l'adresse du site de ${brand.name}.`, true);
    }
    if (ins.domainAgeDays !== null && ins.domainAgeDays < 30) add(20, "link_inspection", `The website behind the link was created ${ins.domainAgeDays} days ago.`, `Le site derrière le lien a été créé il y a ${ins.domainAgeDays} jours.`, true);
    if (ins.isFreeHosting && brand) add(25, "link_inspection", "The page sits on a free website-builder address, which real companies never use.", "La page est hébergée sur une adresse gratuite de création de sites, ce qu'une vraie entreprise n'utilise jamais.", true);
    if (ins.pageShows && /(cop(y|ie)|clone|fake|faux|fausse).{0,60}(login|connexion|banque|bank)|(demande|asks for).{0,30}(codes|card)/i.test(ins.pageShows)) {
      add(20, "link_inspection", "The page behind the link copies a login page and asks for secret codes.", "La page derrière le lien copie une page de connexion et demande des codes secrets.", true);
    }
    if (ins.deadLink) add(10, "link_inspection", "One link in this message leads to a website address that no longer answers. Do not rely on it; open the official app yourself.", "Un lien de ce message mène vers une adresse qui ne répond plus. Ouvrez vous-même l'application officielle.");
    if (ins.isShortener) add(10, "link", "The link is shortened, so its real destination is hidden.", "Le lien est raccourci : sa vraie destination est cachée.");
    if (ins.isIpAddress) add(15, "link", "The link leads to a bare number address, not a company website.", "Le lien mène vers une adresse en chiffres, pas vers le site d'une entreprise.");
  }
  if (linkNotBrand) impersonation = true;

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
  const neverAsk = RE.giftCard.test(askText) || RE.crypto.test(askText) || RE.codeAsk.test(askText) || RE.passwordAsk.test(askText) || RE.moveMoney.test(askText) || /(wire transfer|upfront fee|virement)/i.test(askText);
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
  if (brand && ["Microsoft", "Apple"].includes(brand.name) && /call/i.test(text) && /warning|infected|security|alerte|infecté/i.test(text)) {
    impersonation = true;
    add(30, "sender", `${brand.name} never puts a phone number in a security warning. Close the window.`, `${brand.name} ne met jamais de numéro de téléphone dans une alerte de sécurité. Fermez la fenêtre.`, true);
  }

  // --- Trusted contact behaving out of character ---
  const contact = trustedContactFor(ctx, message.from, message.fromName)
    || (message.claimedContact ? (ctx.trustedContacts || []).find((c) => c.name.toLowerCase() === message.claimedContact.toLowerCase()) : null);
  const fromKnownDevice = contact && (message.from === contact.email || message.from === contact.phone);
  const claimsNewNumber = /changed my number|new number|nouveau numéro/i.test(text);
  const outOfCharacter = contact && (neverAsk || RE.secrecy.test(askText) || RE.moneyAsk.test(askText)
    || (replyDomain && replyDomain !== fromDomain) || (message.claimedContact && !fromKnownDevice && (RE.moneyAsk.test(text) || claimsNewNumber)));
  if (outOfCharacter) {
    add(20, "contact_history",
      `This is really ${contact.name}'s address, but ${contact.name} has never asked you for money or secrecy like this.`,
      `C'est bien l'adresse de ${contact.name}, mais ${contact.name} ne vous a jamais demandé d'argent ni de secret ainsi.`, true);
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
  const authenticBrandMail = brand && senderIsBrand && authPassed(auth) && (senderMatchesHistory || provider || isKnownHistory(ctx, message));
  let verdict;
  if (outOfCharacter) verdict = "be_careful";
  else if (authenticBrandMail && !neverAsk && !linkNotBrand) {
    verdict = /new device|security alert|nouvel appareil|alerte|password (changed|updated)|mot de passe (enregistré|modifié|changé)|modification de votre mot de passe|sécuriser/i.test(text) ? "be_careful" : "safe";
  } else if (contact && !outOfCharacter) verdict = "safe";
  else if ((impersonation && (inspections.length || neverAsk || RE.callOnly.test(text) || RE.moneyAsk.test(text))) || (neverAsk && !contact) || matchedActive.length && score >= 40) verdict = "scam";
  else if (score >= 55 && impersonation) verdict = "scam";
  else if (score >= 18 || matchedCandidate.length || threadEscalation) verdict = "be_careful";
  else verdict = "safe";
  if (matchedCandidate.length && !matchedActive.length && verdict === "scam" && !impersonation && !neverAsk) verdict = "be_careful";
  if (threadEscalation && verdict === "safe") verdict = "be_careful";
  // A slow-burn thread alone proves a direction, not yet a completed scam.
  if (threadEscalation && !impersonation && verdict === "scam") verdict = "be_careful";

  const confidence = verdict === "scam" ? Math.min(0.97, 0.75 + score / 200)
    : verdict === "safe" ? (authenticBrandMail || contact ? 0.9 : 0.72)
    : Math.min(0.9, 0.6 + score / 150);

  const headline = verdict === "scam" ? L("Scam: do not click, pay, or reply to this.", "Arnaque : ne cliquez pas, ne payez rien, ne répondez pas.")
    : verdict === "be_careful" ? L("Be careful: check this before you do anything.", "Attention : vérifiez avant de faire quoi que ce soit.")
    : L("Safe: this looks like a genuine message.", "Rassurez-vous : ce message semble authentique.");

  const scamType = scamTypeFor({ brand, text, contact, threadEscalation, channel: message.channel });
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
  const authentic = Boolean((authenticBrandMail && !neverAsk && !linkNotBrand) || (contact && !outOfCharacter));
  return { ...out, _score: score, _signals: signals, _authentic: authentic };
}

function looksLikeAddress(text) {
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(String(text || "").trim());
}

function isKnownHistory(ctx, message) {
  return (ctx.knownSenders || []).some((s) => s.email?.toLowerCase() === String(message.from || "").toLowerCase());
}

function scamTypeFor({ brand, text, contact, threadEscalation }) {
  if (contact) return "account_takeover_contact";
  if (threadEscalation) return "romance_investment";
  if (/webcam|filmed you| Sextortion|bitcoin.*48/i.test(text)) return "sextortion";
  if (/recover (your )?(lost )?money|law firm.*recover|fonds perdus/i.test(text)) return "recovery";
  if (RE.codeAsk.test(text)) return "code_theft";
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
