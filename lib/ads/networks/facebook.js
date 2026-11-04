// Facebook ads through Meta's Marketing API (_product/specs/ad-studio.md, lines 6, 9 and 10; contract C3 in
// docs/plans/2026-11-04-ad-studio.md): one approved idea becomes one ad set holding one ad, in the one
// "Prudence" campaign (created on the first publish, then reused), shown to adults 35 to 64 in the United
// States in the Facebook feed, linking to the idea's landing variant. Pause, Resume and the review state.
// Raw HTTP through an injectable fetch, so tests run with no network. The keys are read at call time.
// The token travels only in the Authorization header, never in a URL; an error carries Graph's own words and
// code, never the token nor a URL with a query. No create is retried: a create that fails after the ad set
// exists deletes what this call made (ad, creative, ad set; never the campaign), then throws.
//
// Checked at the source on 2026-11-04 (developers.facebook.com; the reference pages show v25.0 and v26.0):
// - Campaign, POST /act_<id>/campaigns (https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group):
//   OUTCOME_TRAFFIC is in the objective enum; special_ad_categories is required, "NONE or ... an empty array";
//   buying_type defaults to AUCTION; only ACTIVE and PAUSED at creation; "You can either set budget at the
//   campaign level or at the adset level, not both"; without a campaign budget, bid_strategy goes on the ad set.
// - is_adset_budget_sharing_enabled: "Starting with v24.0+, you must pass either True or False" when the budget
//   is on the ad set (https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/guides/adset-budget-sharing).
// - Ad set, POST /act_<id>/adsets (https://developers.facebook.com/docs/marketing-api/reference/ad-account/adsets and
//   .../reference/ad-campaign): daily_budget in the account currency, "specified in cents" in the basic guide
//   (.../marketing-api/get-started/basic-ad-creation/create-an-ad-set), allowed only for an ad set longer than
//   24 hours (so ADS_DAYS is 2 at least); billing_event IMPRESSIONS and optimization_goal LINK_CLICKS are in the
//   enums; bid_strategy LOWEST_COST_WITHOUT_CAP needs no bid_amount; start_time and end_time take a UTC UNIX
//   timestamp; destination_type is optional (.../marketing-api/adset/destination_type/), so none is sent: the
//   creative's link makes it a website ad.
// - Currency offsets (https://developers.facebook.com/docs/marketing-api/currencies): offset 100 means hundredths,
//   offset 1 the unit itself; CLP, COP, CRC, HUF, ISK, IDR, JPY, KRW, PYG, TWD and VND are 1, the rest 100.
// - Advantage+ audience: from v23.0 a new ad set with a non-default age must set targeting_automation.advantage_audience
//   to 1 or 0 (https://developers.facebook.com/blog/post/2025/06/13/marketing-api-changes-to-advantage-plus-audience-behaviors/);
//   0 keeps 35 to 64 a hard limit rather than a suggestion.
// - Image, POST /act_<id>/adimages with bytes (base64); the answer maps images to { hash, url, ... }
//   (.../reference/ad-account/adimages, .../reference/ad-image/).
// - Creative, POST /act_<id>/adcreatives with object_story_spec { page_id, link_data } (.../reference/ad-account/adcreatives);
//   link_data's link "is required to be the same as the CTA link url", message is "the main body", name the title,
//   image_hash "an image in your ad account's image library" (.../reference/ad-creative-link-data/); LEARN_MORE and
//   SIGN_UP are in the call-to-action enum (.../reference/ad-creative-link-data-call-to-action/).
// - Ad, POST /act_<id>/ads { name, adset_id, creative: { creative_id }, status } (.../reference/adgroup, examples in
//   v26.0); effective_status is one of ACTIVE, PAUSED, DELETED, PENDING_REVIEW, DISAPPROVED, PREAPPROVED,
//   PENDING_BILLING_INFO, CAMPAIGN_PAUSED, ARCHIVED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES; DELETE /<ad id>;
//   ad_review_feedback is { global: { <key>: <description> }, placement_specific } (.../reference/adgroup-review-feedback/).
// - Permissions (https://developers.facebook.com/docs/permissions): ads_management (depends on pages_read_engagement
//   and pages_show_list), pages_manage_ads ("Create ads for your Page"); standard access is enough for your own
//   ad account (.../marketing-api/get-started/authorization), so no App Review.
// Unverified until the first live publish: the Bearer header on the Marketing API (the Messenger adapter assumes the
// same); POST /<id> with status to pause and resume (the reference's update example uses adgroup_status, its create
// table says other statuses "can be used for update"); DELETE on an ad set and a creative; the key under images (the
// first entry with a hash is taken); whether Meta adds Advantage+ creative enhancements when no
// degrees_of_freedom_spec is sent (none is); how long the review takes.

// The Messenger adapter's version (src/channels/messenger.js DEFAULT_GRAPH_VERSION); lib/ never imports src/,
// so it is repeated here and tests/ads-facebook.test.js keeps the two equal.
export const DEFAULT_GRAPH_VERSION = "v26.0";
export const GRAPH_URL = "https://graph.facebook.com";
export const CAMPAIGN_NAME = "Prudence";
export const TIMEOUT_MS = 30_000;
export const IMAGE_TIMEOUT_MS = 60_000;
export const KEYS = ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID"];
export const CTA_TYPES = ["LEARN_MORE", "SIGN_UP"];
export const LAUNCH_STATUSES = ["ACTIVE", "PAUSED"];
export const DEFAULTS = Object.freeze({ daily: 5, days: 7, countries: ["US"], ageMin: 35, ageMax: 64, launchStatus: "ACTIVE" });
// A daily budget needs an ad set longer than 24 hours; past 90 days is a typo more likely than a plan.
export const DAYS_RANGE = [2, 90];
// The label's currency until a publish has read the ad account's own (the Hey Prudence account pays in USD).
export const ASSUMED_CURRENCY = "USD";
// Meta's currencies page: these count in units, every other one in hundredths.
export const UNIT_CURRENCIES = ["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"];
const SYMBOLS = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$", NZD: "NZ$", JPY: "¥", INR: "₹", BRL: "R$", MXN: "MX$", KRW: "₩" };
// AdAccount.account_status, in words (.../reference/ad-account). Publishing stops on the ones that cannot advertise.
export const ACCOUNT_STATUS = {
  1: "active", 2: "disabled", 3: "unsettled (an unpaid balance)", 7: "pending a risk review", 8: "pending settlement",
  9: "in a grace period", 100: "pending closure", 101: "closed", 201: "active", 202: "closed",
};
const BLOCKED_ACCOUNT = [2, 3, 100, 101, 202];
// effective_status -> the card's state (spec line 6).
const STATES = {
  PENDING_REVIEW: "in_review", IN_PROCESS: "in_review", ACTIVE: "active", DISAPPROVED: "rejected", WITH_ISSUES: "rejected",
  PAUSED: "paused", ADSET_PAUSED: "paused", CAMPAIGN_PAUSED: "paused",
};
const STEP_WORDS = {
  account: "reading the ad account", image: "uploading the photo", campaign: "creating the Prudence campaign",
  adset: "creating the ad set", creative: "creating the ad's creative", ad: "creating the ad", status: "changing the ad's status",
  review: "reading the ad's review",
};

export class AdNetworkError extends Error {
  constructor(message, { step = "", status = 0, code = null, ...extra } = {}) {
    super(message);
    this.name = "AdNetworkError";
    this.step = step;
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const text = (env, k) => String(env?.[k] ?? "").trim();
const number = (v) => (String(v ?? "").trim() === "" ? NaN : Number(v));
const intIn = (v, lo, hi) => Number.isInteger(number(v)) && number(v) >= lo && number(v) <= hi;

// The keys and the Graph version; an account id given as digits alone gains its act_ prefix.
export function facebookConfig(env = process.env) {
  const rawAccount = text(env, "META_AD_ACCOUNT_ID");
  const digits = rawAccount.replace(/^act_/, "");
  const version = text(env, "META_ADS_GRAPH_VERSION");
  return {
    token: text(env, "META_ADS_TOKEN"),
    rawAccount,
    accountId: /^\d+$/.test(digits) ? `act_${digits}` : "",
    accountDigits: /^\d+$/.test(digits) ? digits : "",
    pageId: text(env, "META_ADS_PAGE_ID") || text(env, "MESSENGER_PAGE_ID"),
    pageFrom: text(env, "META_ADS_PAGE_ID") ? "META_ADS_PAGE_ID" : text(env, "MESSENGER_PAGE_ID") ? "MESSENGER_PAGE_ID" : "",
    graphVersion: /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
  };
}

// The keys publishing cannot go without, blank or unusable (an account id that is not act_<digits>, a Page id
// that is not digits): the console names them, nothing leaves while one is listed.
export function missingKeys(env = process.env) {
  const c = facebookConfig(env);
  return [
    !c.token && "META_ADS_TOKEN",
    !c.accountId && "META_AD_ACCOUNT_ID",
    !/^\d+$/.test(c.pageId) && "META_ADS_PAGE_ID",
  ].filter(Boolean);
}

export const currencyOffset = (currency) => (UNIT_CURRENCIES.includes(String(currency || "").toUpperCase()) ? 1 : 100);
export const currencySymbol = (currency) => SYMBOLS[String(currency || "").toUpperCase()] || "";

// "$5 a day · 7 days"; a currency without a known symbol is named by its code ("5 PLN a day · 7 days").
export function budgetLabel({ daily, currency, days }) {
  const amount = Number.isInteger(daily) ? String(daily) : Number(daily).toFixed(2);
  const symbol = currencySymbol(currency);
  const money = symbol ? `${symbol}${amount}` : `${amount} ${String(currency || "").toUpperCase()}`.trim();
  return `${money} a day · ${days} ${days === 1 ? "day" : "days"}`;
}

// The spend and the audience; a value that is not usable falls back to its default (the label shows what applies).
export function adSettings(env = process.env, currency = ASSUMED_CURRENCY) {
  const daily = number(env.ADS_DAILY_BUDGET);
  const countries = text(env, "ADS_COUNTRIES").toUpperCase().split(/[\s,]+/).filter(Boolean);
  let ageMin = intIn(env.ADS_AGE_MIN, 18, 65) ? number(env.ADS_AGE_MIN) : DEFAULTS.ageMin;
  let ageMax = intIn(env.ADS_AGE_MAX, 18, 65) ? number(env.ADS_AGE_MAX) : DEFAULTS.ageMax;
  if (ageMin > ageMax) [ageMin, ageMax] = [DEFAULTS.ageMin, DEFAULTS.ageMax];
  const launch = text(env, "ADS_LAUNCH_STATUS").toUpperCase();
  const s = {
    daily: Number.isFinite(daily) && daily > 0 ? daily : DEFAULTS.daily,
    currency: String(currency || ASSUMED_CURRENCY).toUpperCase(),
    days: intIn(env.ADS_DAYS, ...DAYS_RANGE) ? number(env.ADS_DAYS) : DEFAULTS.days,
    countries: countries.length && countries.every((c) => /^[A-Z]{2}$/.test(c)) ? [...new Set(countries)] : [...DEFAULTS.countries],
    ageMin,
    ageMax,
    launchStatus: LAUNCH_STATUSES.includes(launch) ? launch : DEFAULTS.launchStatus,
  };
  return { ...s, budgetLabel: budgetLabel(s) };
}

// The ad set's audience (spec line 6): the countries, the ages as a hard limit, the Facebook feed only.
export const targeting = (s) => ({
  geo_locations: { countries: s.countries },
  age_min: s.ageMin,
  age_max: s.ageMax,
  publisher_platforms: ["facebook"],
  facebook_positions: ["feed"],
  targeting_automation: { advantage_audience: 0 },
});

export const reviewState = (effectiveStatus) => STATES[String(effectiveStatus || "").toUpperCase()] || "other";

const humanize = (key) => {
  const words = String(key || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
};
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

// Meta's reasons, each once: the description when there is one, else its key in words ("ADULT_CONTENT" ->
// "Adult content"); global reasons first, then each placement's.
export function reviewReasons(feedback) {
  const out = [];
  const add = (key, value) => {
    const t = oneLine(typeof value === "string" ? value : "") || humanize(key);
    if (t && !out.includes(t)) out.push(t);
  };
  const entries = (m) => (m && typeof m === "object" ? Object.entries(m) : []);
  for (const [k, v] of entries(feedback?.global)) add(k, v);
  for (const [, m] of entries(feedback?.placement_specific)) for (const [k, v] of entries(m)) add(k, v);
  return out;
}

// Whatever a message holds, never the token, and a URL keeps its address but loses its query.
export function scrubText(message, token = "") {
  let s = String(message ?? "");
  if (token && token.length >= 6) s = s.split(token).join("[redacted]");
  return s.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, "$1").replace(/access_token=[^\s&"']+/gi, "access_token=[redacted]");
}

// Graph's error as one plain sentence: what we were doing, Meta's words for a person when it has them, the code.
export function graphMessage(step, httpStatus, error) {
  const what = STEP_WORDS[step] || step;
  const words = oneLine(error?.error_user_msg || error?.message) || `HTTP ${httpStatus}`;
  const code = error?.code != null ? ` (code ${error.code}${error.error_subcode ? `, subcode ${error.error_subcode}` : ""})` : "";
  return `Facebook refused ${what}: ${words}${code}`;
}

// The first image the upload answer names, whatever its key.
export function imageHashFrom(answer) {
  for (const v of Object.values(answer?.images || {})) if (v && typeof v.hash === "string" && v.hash) return v.hash;
  return "";
}

export const adsManagerUrl = (accountDigits, adId) =>
  `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(accountDigits)}&selected_ad_ids=${encodeURIComponent(adId)}`;

// Form fields as Graph reads them: objects and arrays as JSON, the rest as text.
const formOf = (fields) => new URLSearchParams(Object.entries(fields)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));

const isHttps = (u) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } };

// One network. env is read at every call (a key stored while the server runs counts at once); now and the
// default fetch are injectable for tests.
export function createFacebookNetwork({ env, now = Date.now, fetchImpl: defaultFetch } = {}) {
  const getEnv = () => env || process.env;
  const cfg = () => facebookConfig(getEnv());
  const currencies = new Map(); // account id -> the currency its last read named

  const currentSettings = () => adSettings(getEnv(), currencies.get(cfg().accountId) || ASSUMED_CURRENCY);

  function requireKeys() {
    const missing = missingKeys(getEnv());
    if (!missing.length) return cfg();
    const c = cfg();
    const why = missing.map((k) => (k === "META_AD_ACCOUNT_ID" && c.rawAccount ? `${k} (act_ followed by digits, or the digits alone)`
      : k === "META_ADS_PAGE_ID" && c.pageId ? `${k} (the Page's number)` : k));
    throw new AdNetworkError(`Facebook is not set up: missing ${why.join(", ")}`, { step: "keys", missing });
  }

  // One Graph call. A transport failure says which step and why in a word; the URL never appears.
  async function graph(step, { method = "GET", path, query, form, fetchImpl, signal, timeoutMs = TIMEOUT_MS }) {
    const c = cfg();
    const doFetch = fetchImpl || defaultFetch || globalThis.fetch;
    const url = new URL(`${GRAPH_URL}/${c.graphVersion}/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    let res;
    try {
      res = await doFetch(url.href, {
        method, headers: { authorization: `Bearer ${c.token}`, accept: "application/json" }, body: form ? formOf(form) : undefined,
        redirect: "error", signal: AbortSignal.any(signals),
      });
    } catch (e) {
      const why = e?.name === "TimeoutError" ? `no answer in ${timeoutMs / 1000} s`
        : e?.name === "AbortError" ? "stopped before Facebook answered" : `network error (${e?.cause?.code || e?.name || "unknown"})`;
      throw new AdNetworkError(`Facebook could not be reached while ${STEP_WORDS[step] || step}: ${why}`, { step, status: 0 });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const err = json?.error || {};
      throw new AdNetworkError(scrubText(graphMessage(step, res.status, err), c.token), {
        step, status: res.status, code: err.code ?? null, subcode: err.error_subcode ?? null,
      });
    }
    return json;
  }

  // Deletes what a failed publish made, newest first; what could not be deleted is named, never hidden.
  async function cleanup(created, fetchImpl) {
    const left = [];
    for (const { kind, id } of [...created].reverse()) {
      try { await graph("cleanup", { method: "DELETE", path: encodeURIComponent(id), fetchImpl }); } catch { left.push({ kind, id }); }
    }
    return left;
  }

  async function publish({ name, words, photo, link, campaignId, signal, fetchImpl } = {}) {
    const c = requireKeys();
    const adName = oneLine(name).slice(0, 200);
    const w = words || {};
    const cta = String(w.cta || "LEARN_MORE").toUpperCase();
    const bytes = photo?.bytes;
    const problems = [
      !adName && "a name",
      !oneLine(w.headline) && "a headline",
      !oneLine(w.primary_text) && "the main text",
      !CTA_TYPES.includes(cta) && `a button Facebook takes (${CTA_TYPES.join(" or ")})`,
      !(bytes instanceof Uint8Array && bytes.length) && "the photo",
      !isHttps(link) && "an https link",
    ].filter(Boolean);
    if (problems.length) throw new AdNetworkError(`The ad is missing ${problems.join(", ")}`, { step: "input" });

    const call = (step, req) => graph(step, { ...req, fetchImpl, signal });
    const s = currentSettings();

    // The account first: its state, and its currency before any budget is written.
    const account = await call("account", { path: c.accountId, query: { fields: "name,currency,account_status" } });
    const status = Number(account.account_status);
    if (BLOCKED_ACCOUNT.includes(status)) {
      throw new AdNetworkError(`The ad account is ${ACCOUNT_STATUS[status]}: Facebook takes no new ads from it (Business settings → Ad accounts)`, { step: "account", status: 0 });
    }
    const currency = String(account.currency || "").toUpperCase();
    if (!currency) throw new AdNetworkError("Facebook did not say the ad account's currency", { step: "account" });
    currencies.set(c.accountId, currency);
    if (currency !== s.currency) {
      // The button named another currency: nothing is created, and the next label names the right one.
      const label = currentSettings().budgetLabel;
      throw new AdNetworkError(`The ad account pays in ${currency}, not ${s.currency}: the button now reads "${label}"; check it and publish again`, { step: "budget" });
    }
    const dailyMinor = Math.round(s.daily * currencyOffset(currency));

    const uploaded = await call("image", {
      method: "POST", path: `${c.accountId}/adimages`, form: { bytes: Buffer.from(bytes).toString("base64") }, timeoutMs: IMAGE_TIMEOUT_MS,
    });
    const imageHash = imageHashFrom(uploaded);
    if (!imageHash) throw new AdNetworkError("Facebook took the photo but returned no image hash", { step: "image" });

    let campaignCreated = false;
    let campaign = String(campaignId || "").trim();
    if (!campaign) {
      const r = await call("campaign", {
        method: "POST", path: `${c.accountId}/campaigns`,
        form: {
          name: CAMPAIGN_NAME, objective: "OUTCOME_TRAFFIC", status: "ACTIVE", buying_type: "AUCTION",
          special_ad_categories: [], is_adset_budget_sharing_enabled: false,
        },
      });
      if (!r.id) throw new AdNetworkError("Facebook created no campaign id", { step: "campaign" });
      campaign = String(r.id);
      campaignCreated = true;
    }

    const created = [];
    const startedAt = now();
    const endsAtMs = startedAt + s.days * 86_400_000;
    let step = "adset";
    try {
      const adset = await call("adset", {
        method: "POST", path: `${c.accountId}/adsets`,
        form: {
          name: adName, campaign_id: campaign, daily_budget: dailyMinor, billing_event: "IMPRESSIONS", optimization_goal: "LINK_CLICKS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP", start_time: Math.floor(startedAt / 1000), end_time: Math.floor(endsAtMs / 1000),
          targeting: targeting(s), status: s.launchStatus,
        },
      });
      if (!adset.id) throw new AdNetworkError("Facebook created no ad set id", { step: "adset" });
      created.push({ kind: "ad set", id: String(adset.id) });

      step = "creative";
      const creative = await call("creative", {
        method: "POST", path: `${c.accountId}/adcreatives`,
        form: {
          name: adName,
          object_story_spec: {
            page_id: c.pageId,
            link_data: {
              link, message: oneLine(w.primary_text), name: oneLine(w.headline), ...(oneLine(w.description) ? { description: oneLine(w.description) } : {}),
              image_hash: imageHash, call_to_action: { type: cta, value: { link } },
            },
          },
        },
      });
      if (!creative.id) throw new AdNetworkError("Facebook created no creative id", { step: "creative" });
      created.push({ kind: "creative", id: String(creative.id) });

      step = "ad";
      const ad = await call("ad", {
        method: "POST", path: `${c.accountId}/ads`,
        form: { name: adName, adset_id: String(adset.id), creative: { creative_id: String(creative.id) }, status: s.launchStatus },
      });
      if (!ad.id) throw new AdNetworkError("Facebook created no ad id", { step: "ad" });

      return {
        campaignId: campaign, campaignCreated, adsetId: String(adset.id), creativeId: String(creative.id), adId: String(ad.id), imageHash,
        status: s.launchStatus, adsManagerUrl: adsManagerUrl(c.accountDigits, ad.id),
        budget: { daily: s.daily, currency, days: s.days, endsAt: new Date(endsAtMs).toISOString() },
      };
    } catch (e) {
      const err = e instanceof AdNetworkError ? e : new AdNetworkError(`Publishing stopped while ${STEP_WORDS[step]}`, { step });
      const left = created.length ? await cleanup(created, fetchImpl) : [];
      if (left.length) err.message += `; left on Facebook: ${left.map((x) => `${x.kind} ${x.id}`).join(", ")} (delete it in Ads Manager)`;
      err.leftovers = left;
      // A campaign made by this call stays (it is empty and costs nothing): the caller stores it, so the next
      // publish reuses it instead of making a second "Prudence".
      if (campaignCreated) Object.assign(err, { campaignId: campaign, campaignCreated: true });
      throw err;
    }
  }

  // Pause stops delivery first (the ad, then its ad set); Resume starts the ad set, then the ad. A failure
  // half way leaves it not delivering, and the error says which part changed.
  async function setStatus({ adId, adsetId, status, signal, fetchImpl } = {}) {
    requireKeys();
    const want = String(status || "").toUpperCase();
    if (!LAUNCH_STATUSES.includes(want)) throw new AdNetworkError("The status is PAUSED or ACTIVE", { step: "input" });
    if (!adId) throw new AdNetworkError("The ad's number is missing", { step: "input" });
    const ids = [["ad", adId], ...(adsetId ? [["ad set", adsetId]] : [])];
    const order = want === "PAUSED" ? ids : [...ids].reverse();
    const done = [];
    for (const [kind, id] of order) {
      try {
        await graph("status", { method: "POST", path: encodeURIComponent(String(id)), form: { status: want }, fetchImpl, signal });
      } catch (e) {
        if (done.length) e.message += ` (the ${done.join(" and ")} ${done.length > 1 ? "are" : "is"} already ${want.toLowerCase()})`;
        e.done = [...done];
        throw e;
      }
      done.push(kind);
    }
    return { adId: String(adId), adsetId: adsetId ? String(adsetId) : null, status: want };
  }

  async function review({ adId, signal, fetchImpl } = {}) {
    requireKeys();
    if (!adId) throw new AdNetworkError("The ad's number is missing", { step: "input" });
    const r = await graph("review", { path: encodeURIComponent(String(adId)), query: { fields: "effective_status,ad_review_feedback" }, fetchImpl, signal });
    const effectiveStatus = String(r.effective_status || "").toUpperCase();
    const reasons = reviewReasons(r.ad_review_feedback);
    if (effectiveStatus === "PENDING_BILLING_INFO" && !reasons.length) reasons.push("The ad account has no payment method yet");
    return { state: reviewState(effectiveStatus), effectiveStatus, reasons };
  }

  return {
    name: "facebook",
    label: "Facebook",
    configured: () => missingKeys(getEnv()).length === 0,
    missingKeys: () => missingKeys(getEnv()),
    settings: currentSettings,
    publish,
    setStatus,
    review,
  };
}

// The one the app uses: process.env, read at every call.
export const facebook = createFacebookNetwork();
export default facebook;
