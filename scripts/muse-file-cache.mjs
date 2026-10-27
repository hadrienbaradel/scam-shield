// A file-backed cache for evaluation runs, so re-running a Muse Spark
// evaluation never pays twice for the same request. Same get/set shape as
// the per-user database cache (src/sync/checker.js llmCacheFor).
//   const cache = await fileCache(".runtime/eval/muse-cache.json"); ... await cache.save();
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function fileCache(path) {
  let data = {};
  try { data = JSON.parse(await readFile(path, "utf8")); } catch { data = {}; }
  let dirty = 0;
  return {
    get: (key) => data[key] || null,
    set: (key, verdict) => { data[key] = verdict; dirty++; },
    save: async () => {
      if (!dirty) return;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(data), { mode: 0o600 });
      dirty = 0;
    },
  };
}

// Token totals and latency over a run's Muse answers (cached ones cost nothing).
export function usageSummary(verdicts) {
  const paid = verdicts.filter((v) => v?.usage && !/cached/.test(v.source || ""));
  const sum = (k) => paid.reduce((n, v) => n + (Number(v.usage[k]) || 0), 0);
  const ms = paid.map((v) => v.latency_ms || 0).sort((a, b) => a - b);
  return {
    calls: paid.length,
    cached: verdicts.filter((v) => /cached/.test(v?.source || "")).length,
    degraded: verdicts.filter((v) => v?.degraded).length,
    promptTokens: sum("prompt_tokens") || sum("input_tokens"),
    completionTokens: sum("completion_tokens") || sum("output_tokens"),
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
  };
}
