import pg from "pg";
import { config } from "../config.js";

// jsonb and timestamptz come back as JS objects/Dates; bigint as string.
// A connection, or a free client when all 10 are busy, is waited for 5 s at
// most: an unreachable database fails a query instead of leaving it hanging
// (pg waits forever by default; /api/health gives up after 2 s).
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
