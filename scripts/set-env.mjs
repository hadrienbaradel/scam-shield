// Sets keys in .env without printing the file (it holds secrets).
// Usage: node scripts/set-env.mjs KEY=value [KEY2=value2 ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const path = new URL("../.env", import.meta.url);

// pairs: [[key, value], ...]. Returns the keys written.
export function setEnv(pairs) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of pairs) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
  return pairs.map(([key]) => key);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pairs = [];
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf("=");
    if (i < 1) { console.error(`skip: ${arg.split("=")[0]} (expected KEY=value)`); continue; }
    pairs.push([arg.slice(0, i), arg.slice(i + 1)]);
  }
  for (const key of setEnv(pairs)) console.log(`set ${key}`);
}
