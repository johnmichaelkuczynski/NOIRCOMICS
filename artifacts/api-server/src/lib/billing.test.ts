import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { identify, issueSession, reserveCredits, FREE_LIMITS, PAID_LIMITS } from "./billing";
import type { Request } from "express";

if (process.env.NODE_ENV === "production") throw new Error("Run billing integration tests only against development.");
const prefix = `billing-test-${randomUUID()}`;
const kinds = ["panels", "scripts", "voices"] as const;
const consumed = { panels: 0, scripts: 0, voices: 0 };
const attempted = { panels: 0, scripts: 0, voices: 0 };
const open: { finish(n: number): Promise<void> }[] = [];
const identity = (name: string, network = name) => ({
  customerId: `${prefix}-${name}`, native: false, network: `${prefix}-${network}`,
});
const free = { subscribed: false, period: "" };
const paid = { subscribed: true, period: "test-period" };
async function reserve(name: string, kind: typeof kinds[number], n: number, tier = paid, network = name) {
  const credit = await reserveCredits(identity(name, network), tier, kind, n);
  if (!tier.subscribed) attempted[kind] += n;
  let closed = false;
  const wrapper = {
    async finish(delivered: number) {
      await credit.finish(delivered);
      if (!closed && !tier.subscribed) consumed[kind] += delivered;
      closed = true;
    },
  };
  open.push(wrapper);
  return wrapper;
}

test("free panel generation stops after exactly twelve panels", async () => {
  const credit = await reserve("free-panels", "panels", FREE_LIMITS.panels, free);
  await credit.finish(FREE_LIMITS.panels);
  await assert.rejects(reserve("free-panels", "panels", 1, free), { status: 402 });
});
test("script regeneration uses the same two-script trial", async () => {
  for (let i = 0; i < FREE_LIMITS.scripts; i++) await (await reserve("free-scripts", "scripts", 1, free)).finish(1);
  await assert.rejects(reserve("free-scripts", "scripts", 1, free), { status: 402 });
});
test("changing a device identifier does not reset a network's trial", async () => {
  await (await reserve("device-original", "panels", 12, free, "shared-network")).finish(12);
  await assert.rejects(reserve("device-reset", "panels", 1, free, "shared-network"), { status: 402 });
});
test("twenty-five parallel paid panels cannot exceed the twenty-four-panel monthly ceiling", async () => {
  const results = await Promise.allSettled(Array.from({ length: PAID_LIMITS.panels + 1 },
    () => reserve("concurrent", "panels", 1)));
  const allowed = results.filter(result => result.status === "fulfilled");
  assert.equal(allowed.length, PAID_LIMITS.panels);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  for (const result of allowed) if (result.status === "fulfilled") await result.value.finish(1);
});
test("unfinished reservations block overspending before the AI call", async () => {
  const credit = await reserve("pending", "panels", 24);
  await assert.rejects(reserve("pending", "panels", 1), { status: 402 });
  await credit.finish(0);
});
test("failed paid calls cannot be retried indefinitely at the owner's expense", async () => {
  const credit = await reserve("failed", "panels", 24);
  await credit.finish(0);
  await assert.rejects(reserve("failed", "panels", 1), { status: 402 });
});
test("settlement is idempotent and cannot refund a completed output", async () => {
  const credit = await reserve("settlement", "panels", 2);
  await credit.finish(2);
  await credit.finish(0);
  const result = await pool.query("SELECT panels,pending_panels FROM billing_usage WHERE key=$1",
    [`paid:${identity("settlement").customerId}:${paid.period}`]);
  assert.equal(result.rows[0].panels, 2);
  assert.equal(result.rows[0].pending_panels, 0);
});
test("a new verified billing period receives a fresh allowance", async () => {
  await (await reserve("renewal", "panels", 24)).finish(24);
  await (await reserve("renewal", "panels", 24, { subscribed: true, period: "next-test-period" })).finish(24);
});
test("a forged device session cannot select a paid account", () => {
  const session = issueSession("a".repeat(64));
  const request = (token: string) => ({ ip: "198.51.100.2", get: () => token }) as unknown as Request;
  assert.equal(identify(request(session.token)).customerId, session.customerId);
  assert.throws(() => identify(request(`${session.customerId}.${"0".repeat(64)}`)), { status: 401 });
});
test("reissuing a session for the same installed-device identifier does not create another trial identity", () => {
  const beforeReinstall = issueSession("c".repeat(64));
  const afterReinstall = issueSession("c".repeat(64));
  assert.equal(beforeReinstall.customerId, afterReinstall.customerId);
  assert.equal(beforeReinstall.token, afterReinstall.token);
});
test("excess panel requests and invalid reservations never reserve credits", async () => {
  await assert.rejects(reserve("oversized", "panels", 25), { status: 402 });
  await assert.rejects(reserve("negative", "panels", -1));
});

after(async () => {
  for (const credit of open) await credit.finish(0);
  // Remove only our synthetic usage, preserving any unrelated development data.
  await pool.query("DELETE FROM billing_usage WHERE key LIKE $1", [`%${prefix}%`]);
  for (const kind of kinds) {
    await pool.query(`UPDATE billing_usage SET ${kind}=GREATEST(0,${kind}-$2),
      attempted_${kind}=GREATEST(0,attempted_${kind}-$3) WHERE key=$1`,
      [`intro:${new Date().toISOString().slice(0, 7)}`, consumed[kind], attempted[kind]]);
  }
  await pool.end();
});
