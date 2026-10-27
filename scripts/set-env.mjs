// Sets keys in .env without printing the file (it holds secrets).
// Usage: node scripts/set-env.mjs KEY=value [KEY2=value2 ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const path = new URL("../.env", import.meta.url);
let text = existsSync(path) ? readFileSync(path, "utf8") : "";
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf("=");
  if (i < 1) { console.error(`skip: ${arg.split("=")[0]} (expected KEY=value)`); continue; }
  const key = arg.slice(0, i);
  const line = `${key}=${arg.slice(i + 1)}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  console.log(`set ${key}`);
}
writeFileSync(path, text, { mode: 0o600 });
