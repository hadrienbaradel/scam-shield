// Imports redacted, classified samples from a CC BY 4.0 SMS corpus into
// the public scam library (spec line 3; lib/libraryImport.js has the
// corpora, the parsers and the pick). The corpus is downloaded once under
// .runtime/library/<source>/ (gitignored: the raw files never enter the
// repo), unzipped with the shell's unzip, parsed; the spam samples not
// already in the library are drawn in a fixed order (--seed, default 1),
// classified by Muse Spark (lib/libraryMuse.js, four at a time), redacted,
// validated and written one file each as data/library/entries/
// lib-uci-<n>.json or lib-mishra-<n>.json, numbered after the entries
// already there, so a re-run adds and never rewrites. A sample the model
// cannot place in a family, or whose entry fails validation, is skipped
// and named; a name warning is printed so a human reads that file before
// committing it. The summary names the model and counts the calls.
//
//   node --import ./lib/credentials.js scripts/library-import.mjs --source uci-sms --limit 100
//   node --import ./lib/credentials.js scripts/library-import.mjs --source mishra-soni --limit 100
//   node scripts/library-import.mjs --source uci-sms --limit 5 --dry --family prize
//     --dry: everything but the files. --family <id>: no model; every entry in that family
//     with an empty lure and ask, for a run without a key, never for what gets committed.

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIBRARY_DIR, bodyHash, loadLibraryFiles, validateEntry } from "../lib/library.js";
import { classifyExample } from "../lib/libraryMuse.js";
import { museConfigured, museLabel, museModel } from "../lib/muse.js";
import { CORPORA, entryFromSample, messageFromSample, nextNumber, pickSamples, sampleId } from "../lib/libraryImport.js";

const execFile = promisify(execFileCb);
const RUNTIME = fileURLToPath(new URL("../.runtime/library/", import.meta.url));
const BATCH = 4;
const UA = "Prudence scam library import (github.com/hadrienbaradel/scam-shield)";

// ------------------------------------------------------------ download ---
async function fetchBytes(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Mendeley lists a record's files through its public API; the answer
// carries each file's download link and its SHA-256, which is checked.
async function mendeleyLink(api, zip) {
  const files = JSON.parse((await fetchBytes(api)).toString("utf8"));
  const f = Array.isArray(files) ? files.find((x) => x?.filename === zip) : null;
  if (!f?.content_details?.download_url) throw new Error(`${zip} not listed at ${api}`);
  return { url: f.content_details.download_url, sha256: f.content_details.sha256_hash || null };
}

export async function downloadCorpus(corpus, { dir = join(RUNTIME, corpus.id), log = console.log } = {}) {
  const { download } = corpus;
  const file = join(dir, download.file);
  if (existsSync(file)) return file;
  await mkdir(dir, { recursive: true });
  const zip = join(dir, download.zip);
  if (!existsSync(zip)) {
    const { url, sha256 } = download.url ? { url: download.url, sha256: null } : await mendeleyLink(download.api, download.zip);
    log(`Downloading ${url}`);
    const bytes = await fetchBytes(url);
    if (sha256 && createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`${download.zip}: the download does not match the SHA-256 the record lists`);
    await writeFile(zip, bytes);
  }
  await execFile("unzip", ["-o", "-q", zip, "-d", dir]);
  if (!existsSync(file)) throw new Error(`${download.file} not found in ${zip}`);
  return file;
}

// -------------------------------------------------------------- import ---
// Returns { written, skipped: { unclassified, invalid }, byFamily, calls }.
// `classify` is the model (default Muse Spark through classifyExample);
// `family` replaces it; `file` is the corpus file (default: downloaded).
export async function importCorpus({ source, limit = 100, seed = 1, dry = false, family = null, file = null, dir = LIBRARY_DIR, classify = null, log = console.log }) {
  const corpus = CORPORA[source];
  if (!corpus) throw new Error(`unknown source ${source}: one of ${Object.keys(CORPORA).join(", ")}`);
  const { families, sources, entries } = await loadLibraryFiles(dir);
  const sourceRow = sources.find((s) => s.id === corpus.id);
  if (!sourceRow) throw new Error(`no ${corpus.id} row in ${join(dir, "sources.json")}`);
  if (family && !families.some((f) => f.id === family)) throw new Error(`unknown family ${family}`);
  if (!family && !classify && !museConfigured()) {
    throw new Error("Muse Spark is not configured: run with node --import ./lib/credentials.js (META_MODEL_API_KEY, _product/docs/llm.md), or pass --family <id> for a run without the model");
  }
  const model = classify ?? ((input) => classifyExample(input));

  const path = file ?? await downloadCorpus(corpus, { log });
  const rows = corpus.parse(await readFile(path, "utf8"));
  const existingHashes = new Set(entries.map((e) => bodyHash(e.message)));
  const candidates = pickSamples(rows, { limit: 0, existingHashes, seed });
  log(`${source}: ${rows.length} rows, ${candidates.length} spam samples not yet in the library; importing up to ${limit}${dry ? " (dry run)" : ""}`);

  let calls = 0;
  const classifyOne = async (sample) => {
    if (family) return { family, brand: null, lure: "", ask: "" };
    const message = messageFromSample(sample);
    for (let attempt = 1; ; attempt++) {
      calls++;
      try { return await model({ channel: "sms", message, families }); } catch (e) {
        if (attempt >= 2) throw e;
        log(`  retrying after: ${e.message}`);
      }
    }
  };

  let n = nextNumber(entries.map((e) => e.id), corpus.prefix);
  const written = [];
  const skipped = { unclassified: 0, invalid: 0 };
  const byFamily = {};
  await mkdir(join(dir, "entries"), { recursive: true });
  // Four at a time, never more than are still needed: no call is spent past the limit.
  for (let i = 0; i < candidates.length && written.length < limit;) {
    const batch = candidates.slice(i, i + Math.min(BATCH, limit - written.length));
    i += batch.length;
    const results = await Promise.all(batch.map(classifyOne));
    for (const [j, sample] of batch.entries()) {
      const classification = results[j];
      if (!classification.family) { skipped.unclassified++; log(`  skipped, no family: ${sample.body.slice(0, 70)}`); continue; }
      const entry = entryFromSample(sample, { id: sampleId(corpus.prefix, n), source: sourceRow, classification, firstSeen: corpus.seen });
      const errors = validateEntry(entry, { families, sources });
      if (errors.length) { skipped.invalid++; log(`  skipped (${errors.join("; ")}): ${entry.message.body.slice(0, 70)}`); continue; }
      for (const w of errors.warnings) log(`  ${entry.id}: ${w}`);
      if (!dry) await writeFile(join(dir, "entries", `${entry.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
      n++;
      written.push(entry);
      byFamily[entry.family] = (byFamily[entry.family] || 0) + 1;
    }
  }
  const ids = written.length ? ` (${written[0].id} to ${written.at(-1).id})` : "";
  const who = family ? `no model, --family ${family}` : classify ? "a stand-in classifier" : `${museLabel()} (${museModel()})`;
  log(`${source}: ${written.length} entries ${dry ? "would be " : ""}written${ids}, ${skipped.unclassified} without a family, ${skipped.invalid} invalid, ${calls} calls to ${who}`);
  log(`  by family: ${Object.entries(byFamily).sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} ${c}`).join(", ") || "none"}`);
  return { written, skipped, byFamily, calls };
}

// ----------------------------------------------------------------- cli ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const source = opt("--source", null);
  const limit = Number(opt("--limit", 100));
  const seed = Number(opt("--seed", 1));
  const family = opt("--family", null);
  const dry = flag("--dry");
  if (!source || !CORPORA[source] || args.length || !(limit > 0)) {
    console.error(`usage: node --import ./lib/credentials.js scripts/library-import.mjs --source ${Object.keys(CORPORA).join("|")} [--limit 100] [--seed 1] [--dry] [--family <id>]`);
    process.exit(2);
  }
  try {
    await importCorpus({ source, limit, seed, dry, family });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
