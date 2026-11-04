#!/usr/bin/env node
// Lesson files checker: every data/lessons/<lang>/<id>.yaml follows the
// lesson format of _product/specs/micro-learning.md (fields; a story that
// starts and ends with a say, never more than two says in a row, the
// character's own text at least once; 1 to 3 lines per say, from the
// narrator, the character or you, the name he borrows under 40 characters;
// exactly three questions with one right answer each and a tell on every
// other choice; under 140 characters, **bold** only), has its English or
// French twin that plays the same (the same steps, speakers and right
// choices), and names a demo case that exists. `make lessons-check` and
// `make check` run it; exit 1 on any problem.
//
//   node scripts/lessons-check.mjs                this checkout
//   node scripts/lessons-check.mjs --root <dir>   another checkout (the tests use this)
//
// Output: "lessons-check: N lessons in EN and FR, M problems", then one line
// per problem, "<file>: <problem>", sorted by file.
//
// Plain Node: reads data/lessons/ and testcases/cases.json, nothing else.

import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLessons } from "../lib/lessons.js";

const USAGE = "usage: node scripts/lessons-check.mjs [--root <dir>]\n";
export const REPO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  let root = REPO_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = resolve(a.slice("--root=".length));
    else if (a === "--help" || a === "-h") { out.write(USAGE); return 0; }
    else { err.write(`lessons-check: unknown argument ${a}\n${USAGE}`); return 2; }
  }
  const { lessons, problems } = loadLessons({ dir: join(root, "data", "lessons"), casesFile: join(root, "testcases", "cases.json") });
  const lines = [`lessons-check: ${lessons.en.length} lessons in EN and FR, ${problems.length} problems`];
  for (const p of problems) lines.push(`${relative(root, p.file) || p.file}: ${p.problem}`);
  out.write(`${lines.join("\n")}\n`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
