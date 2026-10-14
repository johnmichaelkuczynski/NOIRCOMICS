import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { ComicServiceError } from "./comic-providers";

export const FREE_COMICS = 2;
type Trial = { panels: number; pending_panels: number; reserved_until: Date | null };
const keyFor = (customerId: string) => `android-comics:${customerId}`;

export function comicsRemaining(row?: Trial, now = Date.now()) {
  const pending = row?.reserved_until && row.reserved_until.getTime() > now ? row.pending_panels : 0;
  return Math.max(0, FREE_COMICS - Number(row?.panels || 0) - Number(pending));
}

export async function freeComicUsage(customerId: string) {
  const result = await pool.query<Trial>("SELECT panels,pending_panels,reserved_until FROM billing_usage WHERE key=$1", [keyFor(customerId)]);
  return { total: FREE_COMICS, remaining: comicsRemaining(result.rows[0]) };
}

// New records in the existing usage table; no schema changes or old-row rewrites.
export async function reserveFreeComic(customerId: string, requestedPanels: number) {
  if (!Number.isInteger(requestedPanels) || requestedPanels < 1) throw new Error("Invalid comic panel count");
  const key = keyFor(customerId);
  const jobKey = `android-comic-job:${randomUUID()}`;
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("INSERT INTO billing_usage (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
    const result = await connection.query<Trial>("SELECT panels,pending_panels,reserved_until FROM billing_usage WHERE key=$1 FOR UPDATE", [key]);
    const row = result.rows[0]!;
    if (row.pending_panels && row.reserved_until && row.reserved_until.getTime() > Date.now()) {
      throw new ComicServiceError("A comic is already being generated. Wait for it to finish before starting another.", 409);
    }
    if (comicsRemaining(row) < 1) {
      throw new ComicServiceError("Your two free comics have been used. Subscribe to continue. Failed generations do not use your allowance.", 402);
    }
    const lease = await connection.query(
      "UPDATE billing_usage SET pending_panels=1,attempted_panels=attempted_panels+1,reserved_until=NOW()+INTERVAL '15 minutes' WHERE key=$1 RETURNING attempted_panels", [key],
    );
    await connection.query("INSERT INTO billing_usage (key,attempted_panels) VALUES ($1,$2)", [jobKey, lease.rows[0].attempted_panels]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
  let finished = false;
  return {
    async finish(delivered: number) {
      if (finished) return;
      if (!Number.isInteger(delivered) || delivered < 0 || delivered > requestedPanels) throw new Error("Invalid comic settlement");
      const success = delivered === requestedPanels;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Lock in consistent order; the job ledger makes settlement idempotent.
        await client.query("SELECT key FROM billing_usage WHERE key=$1 FOR UPDATE", [key]);
        const settled = await client.query(
          "UPDATE billing_usage SET panels=$2 WHERE key=$1 AND panels=0 RETURNING key",
          [jobKey, success ? 1 : -1],
        );
        if (settled.rowCount) {
          const applied = await client.query(
            "UPDATE billing_usage SET panels=panels+$2,pending_panels=GREATEST(0,pending_panels-1) WHERE key=$1 AND attempted_panels=(SELECT attempted_panels FROM billing_usage WHERE key=$3)",
            [key, success ? 1 : 0, jobKey],
          );
          if (success && !applied.rowCount) throw new ComicServiceError("This comic request expired. No free comic was charged. Please retry.", 409);
        }
        await client.query("COMMIT");
        finished = true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
}
