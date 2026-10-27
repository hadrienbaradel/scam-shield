// Deprecated: keys now live in the encrypted config/credentials.enc (_product/docs/secrets.md). Same usage, forwarded:
//   node scripts/set-env.mjs KEY=value [...]   ==   make secrets-set KEY=value   ==   node scripts/credentials.mjs set KEY=value
import { spawnSync } from "node:child_process";
console.error("note: scripts/set-env.mjs is deprecated, use make secrets-set KEY=value (forwarding)");
process.exit(spawnSync(process.execPath, [new URL("./credentials.mjs", import.meta.url).pathname, "set", ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
