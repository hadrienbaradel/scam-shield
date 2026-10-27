// Applies src/db/migrations/*.sql in order, once each, then seeds the
// pattern cards shipped in data/patterns/cards.json (never overwriting a
// card a reviewer has since changed).
// CLI: npm run migrate

import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./pool.js";

const dir = new URL("./migrations/", import.meta.url);

export async function migrate(db = pool) {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied = [];
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const sql = await readFile(new URL(name, dir), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      applied.push(name);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${name} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
  const cards = JSON.parse(await readFile(new URL("../../data/patterns/cards.json", import.meta.url), "utf8"));
  for (const card of cards) {
    await db.query("INSERT INTO pattern_cards (id, card, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [card.id, card, card.status === "active" ? "active" : "candidate"]);
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const applied = await migrate();
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  await pool.end();
}
