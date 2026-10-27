// Deprecated: keys now live in the encrypted config/credentials.enc (_product/docs/secrets.md). Same usage, forwarded:
//   node scripts/set-env.mjs KEY=value [...]   ==   make secrets-set KEY=value   ==   node scripts/credentials.mjs set KEY=value
// Without the master key yet (a teammate who has not received it), the keys
// go to .env instead, never printed, so setup is not blocked.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { credentialsStatus, setLines } from "../lib/credentialStore.js";

const args = process.argv.slice(2);
if ((credentialsStatus().error || "").startsWith("No master key for ")) {
  const env = new URL("../.env", import.meta.url);
  const pairs = args.filter((a) => a.indexOf("=") > 0).map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]);
  writeFileSync(env, setLines(existsSync(env) ? readFileSync(env, "utf8") : "", pairs), { mode: 0o600 });
  for (const [key] of pairs) console.log(`set ${key} (in .env: no master key yet for config/credentials.enc)`);
  process.exit(0);
}
console.error("note: scripts/set-env.mjs is deprecated, use make secrets-set KEY=value (forwarding)");
process.exit(spawnSync(process.execPath, [new URL("./credentials.mjs", import.meta.url).pathname, "set", ...args], { stdio: "inherit" }).status ?? 1);
