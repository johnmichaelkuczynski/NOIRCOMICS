import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { pool } from "@workspace/db";
import { googleMembership } from "./google-play";
import { verifyGeneration } from "./play-integrity";
import { ComicServiceError } from "./comic-providers";

export const BILLING_VERSION = 3;
export const FREE_LIMITS = { panels: 12, scripts: 2, voices: 12 };
// Conservative cost ceiling. Never advertise unlimited AI generation.
export const PAID_LIMITS = { panels: 24, scripts: 20, voices: 30 };
type Kind = keyof typeof FREE_LIMITS;
type Counts = Record<Kind, number>;
type Identity = { customerId: string; native: boolean; network: string };
type Row = { key: string; reserved_until: Date | null } & Counts &
  { pending_panels: number; pending_scripts: number; pending_voices: number;
    attempted_panels: number; attempted_scripts: number; attempted_voices: number };
type Tier = { subscribed: boolean; period: string; accountId?: string; expiresAt?: string; autoRenew?: boolean };

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new ComicServiceError("Generation is blocked because secure billing is unavailable.", 503);
  return createHmac("sha256", secret).update(`noir-billing-v3:${value}`).digest("hex");
}
function network(req: Request) { return hash(req.ip || req.socket.remoteAddress || "unknown"); }
export function issueSession(deviceId: string) {
  const customerId = `noir_${deviceId}`;
  return { customerId, token: `${customerId}.${signature(customerId)}` };
}
export function identify(req: Request): Identity {
  const net = network(req);
  const token = req.get("X-Noir-Session");
  if (!token) return { customerId: `web_${net}`, native: false, network: net };
  const [customerId, provided, extra] = token.split(".");
  if (extra || !customerId || !/^noir_[a-f0-9]{64}$/.test(customerId) || !provided || !/^[a-f0-9]{64}$/.test(provided)) {
    throw new ComicServiceError("Your secure session is invalid. Reopen the app.", 401);
  }
  const expected = signature(customerId);
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw new ComicServiceError("Your secure session is invalid. Reopen the app.", 401);
  }
  return { customerId, native: true, network: net };
}

export async function membership(identity: Identity): Promise<Tier> {
  if (!identity.native) return { subscribed: false, period: "" };
  try {
    return await googleMembership(identity.customerId);
  } catch {
    // No trusted subscription response means no paid entitlement, never free access.
    throw new ComicServiceError("Subscription verification is unavailable. Generation is blocked to protect your account; try again later.", 503);
  }
}

function buckets(identity: Identity, tier: Tier) {
  if (tier.subscribed) return [{ key: `paid:${tier.accountId || identity.customerId}:${tier.period}`, limits: PAID_LIMITS }];
  return [
    { key: `trial:${identity.customerId}`, limits: FREE_LIMITS },
    // Stops clearing app data/changing trial identifiers from creating free requests.
    { key: `network:${identity.network}`, limits: FREE_LIMITS },
    // Aggregate introductory allowance is bounded too, even under distributed abuse.
    { key: `intro:${new Date().toISOString().slice(0, 7)}`, limits: { panels: 120, scripts: 40, voices: 120 } },
  ].sort((a, b) => a.key.localeCompare(b.key));
}
function remaining(row: Row | undefined, kind: Kind, cap: number, attemptCap: number) {
  const pending = row && row.reserved_until && row.reserved_until.getTime() > Date.now()
    ? Number(row[`pending_${kind}` as keyof Row]) : 0;
  return Math.max(0, Math.min(cap - Number(row?.[kind] ?? 0) - pending,
    attemptCap - Number(row?.[`attempted_${kind}` as keyof Row] ?? 0)));
}
function attemptLimit(key: string, cap: number) {
  // Successful outputs are metered separately, but failures cannot create
  // unlimited chargeable retries. Paid and aggregate budgets are strict.
  return key.startsWith("trial:") || key.startsWith("network:") ? cap * 2 : cap;
}

export async function usage(req: Request) {
  const identity = identify(req);
  if (!identity.native) return { version: BILLING_VERSION, desktop: true, unrestricted: true };
  const tier = await membership(identity);
  const scopes = buckets(identity, tier);
  const rows = await pool.query<Row>("SELECT * FROM billing_usage WHERE key = ANY($1::text[])", [scopes.map(s => s.key)]);
  const available = Object.fromEntries((["panels", "scripts", "voices"] as Kind[]).map(kind => [
    kind, Math.min(...scopes.map(scope => remaining(rows.rows.find(row => row.key === scope.key), kind,
      scope.limits[kind], attemptLimit(scope.key, scope.limits[kind])))),
  ])) as Counts;
  return { version: BILLING_VERSION, customerId: identity.customerId, subscribed: tier.subscribed,
    remaining: available, limits: tier.subscribed ? PAID_LIMITS : FREE_LIMITS,
    monthlyLimits: PAID_LIMITS, expiresAt: tier.expiresAt || null, autoRenew: !!tier.autoRenew };
}

// Exported separately to test concurrent credit reservations without paid AI calls.
export async function reserveCredits(identity: Identity, tier: Tier, kind: Kind, amount: number) {
  if (!Number.isInteger(amount) || amount < 1 || !(kind in FREE_LIMITS)) throw new Error("Invalid credit reservation");
  const scopes = buckets(identity, tier);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    for (const scope of scopes) {
      await connection.query("INSERT INTO billing_usage (key) VALUES ($1) ON CONFLICT DO NOTHING", [scope.key]);
      const locked = await connection.query<Row>("SELECT * FROM billing_usage WHERE key=$1 FOR UPDATE", [scope.key]);
      const row = locked.rows[0]!;
      if (remaining(row, kind, scope.limits[kind], attemptLimit(scope.key, scope.limits[kind])) < amount) {
        throw new ComicServiceError(tier.subscribed
          ? `Your monthly ${kind} allowance is used up. Further generation is blocked until your next period.`
          : `Your free ${kind} allowance is used up or this request exceeds what remains. Subscribe in the Android app, or choose fewer panels. No generation was charged.`, 402);
      }
      if (!row.reserved_until || row.reserved_until.getTime() <= Date.now()) {
        await connection.query("UPDATE billing_usage SET pending_panels=0,pending_scripts=0,pending_voices=0 WHERE key=$1", [scope.key]);
      }
      // Column names come only from the server-owned Kind union, never user input.
      await connection.query(`UPDATE billing_usage SET pending_${kind}=pending_${kind}+$2,
        attempted_${kind}=attempted_${kind}+$2,reserved_until=NOW()+INTERVAL '15 minutes' WHERE key=$1`, [scope.key, amount]);
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
  let finished = false;
  return {
    async finish(delivered: number) {
      if (finished) return;
      if (!Number.isInteger(delivered) || delivered < 0 || delivered > amount) throw new Error("Invalid credit settlement");
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const scope of scopes) {
          await c.query(`UPDATE billing_usage SET ${kind}=${kind}+$2,pending_${kind}=GREATEST(0,pending_${kind}-$3) WHERE key=$1`, [scope.key, delivered, amount]);
        }
        await c.query("COMMIT");
        finished = true;
      } catch (error) { await c.query("ROLLBACK"); throw error; }
      finally { c.release(); }
    },
  };
}
export async function reserveForRequest(req: Request, kind: Kind, amount: number) {
  try {
    const identity = identify(req);
    if (!identity.native) {
      if (!Number.isInteger(amount) || amount < 1 || !(kind in FREE_LIMITS)) throw new ComicServiceError("Invalid generation request.", 400);
      // The PC application is independent of the Android subscription system.
      // Preserve its original web access without introducing new auth or quotas.
      return { async finish(_delivered: number) {} };
    }
    if (identity.native) await verifyGeneration(req, identity.customerId);
    return await reserveCredits(identity, await membership(identity), kind, amount);
  } catch (error) {
    if (error instanceof ComicServiceError) throw error;
    throw new ComicServiceError("Usage verification is unavailable. Generation is blocked; please try later.", 503);
  }
}
