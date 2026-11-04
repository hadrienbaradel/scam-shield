// GET /a/<code>: an ad's landing variant (_product/specs/ad-studio.md, lines 7
// and 8; contract C5 in docs/plans/2026-11-04-ad-studio.md). The live landing
// with the ad's headline and opening line (src/ads/landingVariant.js), for an
// ad that is published or paused; an admin opens any other with ?preview=1
// (the console's Preview); anyone else gets the site's plain 404, as for an
// address that does not exist. Each visit is counted on our server
// (ads.visits), with no cookie, no pixel and no script from Facebook: never a
// robot or link previewer (Facebook fetches every ad's link), a preview or an
// admin, and never a HEAD. The address Facebook sends carries an fbclid: the
// route reads only the code and preview, keeps nothing of the query, and logs
// at warn so the request lines (which print the whole address) are not
// written. The page goes out with no-store and the security headers and CSP
// of / (helmet, src/server.js).

import { stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { one, q } from "../db/pool.js";
import { renderVariant } from "../ads/landingVariant.js";

const CODE = /^[a-z0-9]{8}$/;
const SHOWN = ["published", "paused"];
export const ROBOT = /facebookexternalhit|facebot|bot|crawler|spider|preview/i;
const INDEX = fileURLToPath(new URL("../../public/index.html", import.meta.url));

// Whether this request is a visit: a person's browser, not ours.
export const countsAsVisit = ({ method, userAgent, preview, admin }) =>
  method === "GET" && !preview && !admin && !ROBOT.test(String(userAgent ?? ""));

export default async function adLandingRoutes(app, { indexPath = INDEX } = {}) {
  // public/index.html read once, again when a deploy or an edit changes it.
  let cached = { mtimeMs: null, html: "" };
  const indexHtml = async () => {
    const { mtimeMs } = await stat(indexPath);
    if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, html: await readFile(indexPath, "utf8") };
    return cached.html;
  };

  app.get("/a/:code", { logLevel: "warn", config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { code } = request.params;
    if (!CODE.test(code)) return reply.callNotFound();
    const admin = Boolean(request.user?.isAdmin);
    const preview = request.query?.preview === "1";
    const ad = await one(`SELECT a.id, a.status, v.words FROM ads a
                          LEFT JOIN ad_versions v ON v.ad_id = a.id AND v.version = a.version
                          WHERE a.code = $1`, [code]);
    if (!ad || !(SHOWN.includes(ad.status) || (admin && preview))) return reply.callNotFound();
    if (countsAsVisit({ method: request.method, userAgent: request.headers["user-agent"], preview, admin })) {
      await q("UPDATE ads SET visits = visits + 1 WHERE id = $1", [ad.id]);
    }
    const landing = ad.words?.landing || {};
    const page = renderVariant(await indexHtml(), { code, headline: landing.headline, lead: landing.lead });
    return reply.header("cache-control", "no-store").header("x-robots-tag", "noindex").type("text/html; charset=utf-8").send(page);
  });
}
