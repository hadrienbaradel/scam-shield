// Stores a downloaded Google OAuth client (Cloud Console → Clients →
// Download JSON) in .env, so the secret is never copied by hand or shown.
// Usage: node scripts/import-google-client.mjs ~/Downloads/client_secret_XXXX.json
// Checks it is a Web client for this project with this app's redirect URI.
import { readFileSync } from "node:fs";
import { setEnv } from "./set-env.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/import-google-client.mjs path/to/client_secret.json"); process.exit(2); }
let json;
try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(1); }
const web = json.web;
if (!web) { console.error(json.installed ? "This is a Desktop client. Create a Web application client instead." : "Not a Google OAuth client file."); process.exit(1); }
if (!web.client_id || !web.client_secret) { console.error("The file has no client_id or client_secret."); process.exit(1); }

const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const redirect = process.env.GOOGLE_REDIRECT_URI || `${base}/auth/google/callback`;
const problems = [];
if (web.project_id && web.project_id !== "scam-shield-hb26") problems.push(`project is ${web.project_id}, expected scam-shield-hb26`);
if (!(web.redirect_uris || []).includes(redirect)) problems.push(`redirect URI ${redirect} is missing (has: ${(web.redirect_uris || []).join(", ") || "none"})`);
if (!(web.javascript_origins || []).includes(base)) problems.push(`JavaScript origin ${base} is missing`);

for (const key of setEnv([["GOOGLE_CLIENT_ID", web.client_id], ["GOOGLE_CLIENT_SECRET", web.client_secret]])) console.log(`set ${key}`);
console.log(`client …${web.client_id.slice(-30)}`);
if (problems.length) { console.log(`Fix in the Cloud Console, then sign-in will work:\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`Redirect ${redirect} and origin ${base} match. You can delete the downloaded file now.`);
