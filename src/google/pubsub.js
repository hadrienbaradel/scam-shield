// Instant checks without a public URL: Gmail publishes "new mail" events
// to a Pub/Sub topic, and this local worker pulls them from a subscription.
// Credentials: Application Default Credentials (gcloud auth
// application-default login, or GOOGLE_APPLICATION_CREDENTIALS); falls back
// to the signed-in gcloud CLI account for local development.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GoogleAuth } from "google-auth-library";
import { config } from "../config.js";

const run = promisify(execFile);
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/pubsub"] });
let cliToken = { value: null, until: 0 };

// Only ask ADC when credentials exist: otherwise google-auth-library probes
// the cloud metadata server and stalls for seconds on a laptop.
const hasAdc = () => Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  || existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"));

async function bearer() {
  if (hasAdc()) try {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (token) return token;
  } catch { /* no ADC: try the gcloud CLI */ }
  if (cliToken.value && cliToken.until > Date.now()) return cliToken.value;
  const { stdout } = await run("gcloud", ["auth", "print-access-token"], { timeout: 20000 });
  cliToken = { value: stdout.trim(), until: Date.now() + 45 * 60000 };
  return cliToken.value;
}

async function call(path, body, timeoutMs = 30000) {
  const res = await fetch(`https://pubsub.googleapis.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pub/Sub ${res.status}: ${data.error?.message || ""}`);
  return data;
}

// Returns [{ emailAddress, historyId }] and acknowledges them: a missed
// event costs nothing, the next history sync catches up.
export async function pullGmailEvents(subscription = config.google.pubsubSubscription) {
  const data = await call(`${subscription}:pull`, { maxMessages: 50 }, 60000);
  const received = data.receivedMessages || [];
  if (!received.length) return [];
  await call(`${subscription}:acknowledge`, { ackIds: received.map((r) => r.ackId) });
  return received.map((r) => {
    try { return JSON.parse(Buffer.from(r.message.data || "", "base64").toString("utf8")); } catch { return null; }
  }).filter(Boolean);
}
