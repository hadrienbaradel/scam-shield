#!/usr/bin/env node
// The Facebook side of the ad studio (_product/specs/ad-studio.md, lines 6 and 10) in one look, before the first
// publish: whether the keys are there, whether the ad account can advertise and pays with a card, whether the
// token can create ads for the Page, and the token's permissions. Run with the credentials loaded (this file
// reads no config of its own):
//
//   node --import ./lib/credentials.js scripts/ads-check.mjs status
//
// Read-only: only GET requests. Never prints a token: it travels in the Authorization header, a failed line
// names the path, Graph's message and its code, never the URL, and every printed line goes through scrub().
// Exit 1 when a key is missing or a check failed, 2 on a usage error. The decisions are exported pure functions
// (tests/ads-check.test.js); run() only sends what plan() built. Graph's answers are read in the shapes of
// Meta's reference pages (lib/ads/networks/facebook.js names them), unverified live until the keys exist.

import { pathToFileURL } from "node:url";
import { ACCOUNT_STATUS, GRAPH_URL, adSettings, currencyOffset, facebookConfig, missingKeys as networkMissing, scrubText } from "../lib/ads/networks/facebook.js";

export const USAGE = `usage: node --import ./lib/credentials.js scripts/ads-check.mjs status
  status   the keys by name (set or missing), the ad account (name, currency, status, payment method), the Page and
           whether the token can create ads for it, the token's permissions, and the campaign in META_ADS_CAMPAIGN_ID`;

export const TIMEOUT_MS = 20_000;
// ads_management creates the ads (it depends on pages_read_engagement and pages_show_list); pages_manage_ads
// "Create ads for your Page" (developers.facebook.com/docs/permissions, checked 2026-11-04).
export const REQUIRED_PERMISSIONS = ["ads_management", "pages_manage_ads", "pages_read_engagement", "pages_show_list"];
// The Page tasks that let a token advertise for it.
export const AD_TASKS = ["ADVERTISE", "MANAGE"];
// AdAccount.disable_reason, in words (developers.facebook.com/docs/marketing-api/reference/ad-account).
export const DISABLE_REASON = {
  0: "none", 1: "ads integrity policy", 2: "ads IP review", 3: "payment risk", 4: "gray account shut down", 5: "AFC review",
  6: "business integrity review", 7: "permanently closed", 8: "unused reseller account", 9: "unused account", 10: "umbrella ad account",
  11: "business portfolio integrity policy", 12: "misrepresented ad account", 13: "legal entity unshared", 14: "thread review",
  15: "compromised ad account",
};
const ACCOUNT_FIELDS = "name,currency,account_status,disable_reason,funding_source,business";
const CAMPAIGN_FIELDS = "name,objective,status,effective_status";
const SETUP = "_product/docs/secrets.md, the ad studio keys";

export const LABEL = {
  token: "token", permissions: "token permissions", account: "ad account", page: "Page", pageAccess: "Page access", campaign: "stored campaign",
};
const NEEDS = {
  token: ["META_ADS_TOKEN"], permissions: ["META_ADS_TOKEN"], account: ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"],
  page: ["META_ADS_TOKEN", "META_ADS_PAGE_ID"], pageAccess: ["META_ADS_TOKEN", "META_ADS_PAGE_ID"], campaign: ["META_ADS_TOKEN", "META_ADS_CAMPAIGN_ID"],
};
const has = (env, k) => Boolean(String(env?.[k] ?? "").trim());
const campaignId = (env) => String(env?.META_ADS_CAMPAIGN_ID ?? "").trim();

// The keys publishing needs and the environment lacks or cannot use (the network's own rule).
export const missingKeys = (env = {}) => networkMissing(env);

// The requests status sends, without the host and without the token (send() adds it): the ones whose keys
// are there, the stored campaign only when META_ADS_CAMPAIGN_ID names one.
export function plan(command, env = {}) {
  if (command !== "status") return [];
  const c = facebookConfig(env);
  const v = c.graphVersion;
  const seg = (s) => encodeURIComponent(String(s ?? "").trim());
  const missing = new Set(missingKeys(env));
  const usable = (k) => (k === "META_ADS_CAMPAIGN_ID" ? /^\d+$/.test(campaignId(env)) : !missing.has(k));
  const build = {
    token: () => ({ method: "GET", path: `/${v}/me`, query: { fields: "id,name" } }),
    permissions: () => ({ method: "GET", path: `/${v}/me/permissions` }),
    account: () => ({ method: "GET", path: `/${v}/${c.accountId}`, query: { fields: ACCOUNT_FIELDS } }),
    page: () => ({ method: "GET", path: `/${v}/${seg(c.pageId)}`, query: { fields: "id,name" } }),
    pageAccess: () => ({ method: "GET", path: `/${v}/me/accounts`, query: { fields: "id,name,tasks", limit: "100" } }),
    campaign: () => ({ method: "GET", path: `/${v}/${seg(campaignId(env))}`, query: { fields: CAMPAIGN_FIELDS } }),
  };
  return Object.keys(build).filter((s) => NEEDS[s].every(usable)).map((s) => ({ label: LABEL[s], step: s, ...build[s]() }));
}

// Graph's error as "message (code N)", a transport failure as send() named it, "" when the call went through.
function failure(r) {
  const e = r?.json?.error;
  if (e) return `${e.error_user_msg || e.message || "no message"} (code ${e.code ?? "?"}${e.error_subcode ? `, subcode ${e.error_subcode}` : ""})`;
  if (!r?.ok) return r?.error || `HTTP ${r?.status ?? "?"}`;
  return "";
}

const quoted = (s) => (s ? `"${s}"` : "(no name)");

// A parsed answer ({ ok, status, json } or send()'s { ok: false, error }) -> whether the check passed and what to say.
export function assess(step, r, env = {}) {
  const err = failure(r);
  if (err) return { ok: false, text: `FAILED: ${err}` };
  const j = r.json || {};
  switch (step) {
    case "token":
      return { ok: true, text: `works, it acts as ${quoted(j.name)} (${j.id || "?"})` };
    case "permissions": {
      const granted = (j.data || []).filter((p) => p?.status === "granted").map((p) => p.permission);
      const lacking = REQUIRED_PERMISSIONS.filter((p) => !granted.includes(p));
      const listed = REQUIRED_PERMISSIONS.filter((p) => granted.includes(p));
      return lacking.length
        ? { ok: false, text: `missing ${lacking.join(", ")}${listed.length ? ` (granted: ${listed.join(", ")})` : ""}: generate a new system-user token with them ticked` }
        : { ok: true, text: `${listed.join(", ")} granted` };
    }
    case "account": {
      const status = Number(j.account_status);
      const active = status === 1;
      const reason = Number(j.disable_reason);
      const currency = String(j.currency || "").toUpperCase();
      const s = adSettings(env, currency || undefined);
      const paying = Boolean(j.funding_source);
      const parts = [
        `${quoted(j.name)} (${j.id || facebookConfig(env).accountId})`,
        currency ? `currency ${currency}, the button reads "${s.budgetLabel}" (daily_budget ${Math.round(s.daily * currencyOffset(currency))})` : "no currency named",
        `status ${ACCOUNT_STATUS[status] || `unknown (${j.account_status ?? "none"})`}${reason ? `, disabled for ${DISABLE_REASON[reason] || `reason ${reason}`}` : ""}`,
        paying ? "payment method set" : "no payment method reported: ads are created but never shown until a card is added (Billing and payments)",
        j.business?.id ? `in the business portfolio ${quoted(j.business.name)} (${j.business.id})` : "not in a business portfolio",
      ];
      return { ok: active && paying && Boolean(currency), text: parts.join(", ") };
    }
    case "page":
      return { ok: true, text: `${quoted(j.name)} (${j.id || "?"})` };
    case "pageAccess": {
      const pageId = facebookConfig(env).pageId;
      const page = (j.data || []).find((p) => String(p?.id) === pageId);
      if (!page) return { ok: false, text: `the Page ${pageId} is not among the token's Pages: assign it to the system user with the right to create ads` };
      const tasks = (page.tasks || []).map(String);
      const can = tasks.some((t) => AD_TASKS.includes(t));
      return {
        ok: can,
        text: can ? `the token can create ads for ${quoted(page.name)} (tasks ${tasks.join(", ")})`
          : `the token's tasks on ${quoted(page.name)} (${tasks.join(", ") || "none"}) do not include ADVERTISE: give the system user the right to create ads on the Page`,
      };
    }
    case "campaign": {
      const gone = ["DELETED", "ARCHIVED"].includes(String(j.effective_status || j.status || "").toUpperCase());
      const traffic = j.objective === "OUTCOME_TRAFFIC";
      const text = `${quoted(j.name)} (${j.id || campaignId(env)}), objective ${j.objective || "?"}, status ${j.status || "?"}, delivery ${j.effective_status || "?"}`;
      if (gone) return { ok: false, text: `${text}: it is gone, the next publish needs a new one` };
      if (!traffic) return { ok: false, text: `${text}: not a traffic campaign (OUTCOME_TRAFFIC)` };
      return { ok: true, text };
    }
    default:
      return { ok: true, text: "ok" };
  }
}
export const describe = (step, response, env = {}) => `${LABEL[step] || step}: ${assess(step, response, env).text}`;
export const passed = (step, response, env = {}) => assess(step, response, env).ok;

// The keys by name, the Graph version with its value, the spend and audience the button will carry.
export function keyLines(env = {}) {
  const c = facebookConfig(env);
  const s = adSettings(env);
  const page = !c.pageId ? "missing" : !/^\d+$/.test(c.pageId) ? "set, but not the Page's number"
    : c.pageFrom === "MESSENGER_PAGE_ID" ? "set through MESSENGER_PAGE_ID" : "set";
  const campaign = !campaignId(env) ? "not set (optional: the console keeps the campaign it makes)" : /^\d+$/.test(campaignId(env)) ? "set" : "set, but not a number";
  return [
    `META_ADS_TOKEN: ${c.token ? "set" : "missing"}`,
    `META_AD_ACCOUNT_ID: ${!c.rawAccount ? "missing" : c.accountId ? "set" : "set, but not act_<digits>"}`,
    `META_ADS_PAGE_ID: ${page}`,
    `META_ADS_CAMPAIGN_ID: ${campaign}`,
    `META_ADS_GRAPH_VERSION: ${has(env, "META_ADS_GRAPH_VERSION") && c.graphVersion === String(env.META_ADS_GRAPH_VERSION).trim() ? c.graphVersion : `${c.graphVersion} (default)`}`,
    `settings: ${s.budgetLabel} until the account's currency is read, countries ${s.countries.join(", ")}, ages ${s.ageMin} to ${s.ageMax}, Facebook feed, ads start ${s.launchStatus}`,
  ];
}

// Defence in depth: whatever a line holds, no token leaves this script (ours, or a Page token Graph might echo).
export function scrub(text, env = {}) {
  return scrubText(text, facebookConfig(env).token).replace(/\bEAA[A-Za-z0-9]{20,}/g, "[redacted]");
}

// One request: the token in the Authorization header, never in the URL; no redirect followed, so it reaches only
// graph.facebook.com.
async function send(req, env, fetchImpl) {
  const url = new URL(`${GRAPH_URL}${req.path}`);
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, v);
  try {
    const res = await fetchImpl(url.href, {
      method: req.method, headers: { authorization: `Bearer ${facebookConfig(env).token}`, accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch (e) {
    // Only the error's name or code: a transport error message is not trusted to leave the URL out.
    return { ok: false, status: 0, json: {}, error: e?.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : `network error (${e?.cause?.code || e?.name || "unknown"})` };
  }
}

// The command line -> the exit code. env, fetchImpl and out are injectable so the test runs it offline.
export async function run(argv = process.argv.slice(2), { env = process.env, fetchImpl = (...a) => globalThis.fetch(...a), out = console.log } = {}) {
  const [command] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) { out(USAGE); return 0; }
  if (command !== "status") { out(`unknown command: ${command}\n${USAGE}`); return 2; }
  const say = (line) => out(scrub(line, env));
  keyLines(env).forEach(say);
  const missing = missingKeys(env);
  if (missing.length) say(`missing: ${missing.join(", ")}; the checks that need them are skipped (make secrets-set NAME=value; ${SETUP})`);
  let failures = missing.length;
  for (const req of plan(command, env)) {
    const response = await send(req, env, fetchImpl);
    const ok = passed(req.step, response, env);
    say(`${describe(req.step, response, env)}${ok ? "" : `  [${req.method} ${req.path}]`}`);
    if (!ok) failures++;
  }
  say(failures ? `${failures} problem${failures > 1 ? "s" : ""} to fix before publishing` : "ready: the console can publish on Facebook");
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
