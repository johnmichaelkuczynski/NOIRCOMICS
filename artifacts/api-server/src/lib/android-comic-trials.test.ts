import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { comicsRemaining, reserveFreeComic } from "./android-comic-trials";

test("free comic counts are per complete comic, not per panel", () => {
  assert.equal(comicsRemaining(), 2);
  assert.equal(comicsRemaining({ panels: 1, pending_panels: 0, reserved_until: null }), 1);
  assert.equal(comicsRemaining({ panels: 2, pending_panels: 0, reserved_until: null }), 0);
  assert.equal(comicsRemaining({ panels: 0, pending_panels: 1, reserved_until: new Date(Date.now() + 60000) }), 1);
  assert.equal(comicsRemaining({ panels: 0, pending_panels: 1, reserved_until: new Date(0) }), 2);
});

test("transactional trial settlement: failures, two successes, concurrency, reinstall and stale leases", async () => {
  // No remote database is contacted. Model only the SQL used by this module.
  type Row = { panels: number; pending_panels: number; attempted_panels: number; reserved_until: Date | null };
  let rows = new Map<string, Row>();
  const original = pool.connect;
  let tail = Promise.resolve();
  (pool as any).connect = async () => {
    let unlock!: () => void;
    const previous = tail;
    tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    let backup: Map<string, Row>;
    return { release: unlock, async query(sql: string, params: any[] = []) {
      const [key, amount, jobKey] = params;
      if (sql === "BEGIN") { backup = structuredClone(rows); return { rows: [] }; }
      if (sql === "ROLLBACK") { rows = backup!; return { rows: [] }; }
      if (sql === "COMMIT") return { rows: [] };
      if (sql.startsWith("INSERT")) {
        if (!rows.has(key)) rows.set(key, { panels: 0, pending_panels: 0, attempted_panels: amount || 0, reserved_until: null });
        return { rows: [] };
      }
      const row = rows.get(key)!;
      if (sql.startsWith("SELECT")) return { rows: [structuredClone(row)] };
      if (sql.includes("pending_panels=1")) {
        row.pending_panels = 1; row.attempted_panels++; row.reserved_until = new Date(Date.now() + 900000);
        return { rows: [{ attempted_panels: row.attempted_panels }] };
      }
      if (sql.includes("AND panels=0")) {
        if (row.panels !== 0) return { rows: [], rowCount: 0 };
        row.panels = amount; return { rows: [{ key }], rowCount: 1 };
      }
      if (sql.includes("panels=panels+$2")) {
        if (row.attempted_panels !== rows.get(jobKey)!.attempted_panels) return { rowCount: 0 };
        row.panels += amount; row.pending_panels = Math.max(0, row.pending_panels - 1);
        return { rowCount: 1 };
      }
      throw new Error("Unexpected SQL in test fixture");
    }};
  };
  try {
    const identity = "noir_reinstall-stable";
    const failed = await reserveFreeComic(identity, 12);
    await assert.rejects(reserveFreeComic(identity, 1), /already being generated/);
    await failed.finish(0);
    assert.equal(rows.get(`android-comics:${identity}`)!.panels, 0);
    const partial = await reserveFreeComic(identity, 12);
    await partial.finish(6);
    assert.equal(rows.get(`android-comics:${identity}`)!.panels, 0);
    const first = await reserveFreeComic(identity, 12);
    await first.finish(12); await first.finish(12);
    assert.equal(rows.get(`android-comics:${identity}`)!.panels, 1);
    // A new client process with the same stable identity sees the same ledger.
    const second = await reserveFreeComic(identity, 1);
    await second.finish(1);
    await assert.rejects(reserveFreeComic(identity, 1), /two free comics/);
    const late = await reserveFreeComic("noir_lease-test", 1);
    rows.get("android-comics:noir_lease-test")!.reserved_until = new Date(0);
    const replacement = await reserveFreeComic("noir_lease-test", 1);
    await assert.rejects(late.finish(1), /expired/);
    await late.finish(0);
    assert.equal(rows.get("android-comics:noir_lease-test")!.pending_panels, 1);
    await replacement.finish(1);
    assert.equal(rows.get("android-comics:noir_lease-test")!.panels, 1);
  } finally { pool.connect = original; }
});
