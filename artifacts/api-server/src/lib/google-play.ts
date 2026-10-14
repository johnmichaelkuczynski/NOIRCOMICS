import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { pool } from "@workspace/db";
import { ComicServiceError } from "./comic-providers";

export const PLAY_PACKAGE = "nk.noircomicgen2.app";
export const PLAY_PRODUCT = "noir_monthly_v1";
export const PLAY_PLAN = "monthly";
export const PLAY_AUDIENCE = "https://noircomics.ink/api/billing/google-play/notifications";
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type GoogleRequest = (path: string, method?: string, body?: object) => Promise<any>;
export interface GoogleSubscription {
  subscriptionState?: string; acknowledgementState?: string;
  linkedPurchaseToken?: string; testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; latestSuccessfulOrderId?: string;
    offerDetails?: { basePlanId?: string; offerId?: string };
    offerPhase?: { freeTrial?: object };
    autoRenewingPlan?: { autoRenewEnabled?: boolean } }[];
}
type GoogleOrder = { state?: string; orderId?: string; purchaseToken?: string; total?: { units?: string; nanos?: number } };
export type VerifiedPurchase = {
  state: string; active: boolean; expiresAt: Date; orderId: string; autoRenew: boolean;
  linkedToken?: string; accountHash?: string;
};
let auth: GoogleAuth | undefined;
function googleAuth() {
  if (auth) return auth;
  try {
    const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "");
    if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) throw new Error();
    auth = new GoogleAuth({ credentials, scopes: [
      "https://www.googleapis.com/auth/androidpublisher",
      "https://www.googleapis.com/auth/playintegrity",
    ] });
    return auth;
  } catch { throw new ComicServiceError("Google Play service credentials are not configured. Generation remains protected.", 503); }
}
export const googleRequest: GoogleRequest = async (path, method = "GET", body) => {
  const url = path.startsWith("integrity:")
    ? `https://playintegrity.googleapis.com/v1/${PLAY_PACKAGE}:decodeIntegrityToken`
    : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}${path}`;
  try {
    const accessToken = await googleAuth().getAccessToken();
    if (!accessToken) throw new Error();
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) throw new ComicServiceError("Google Play did not recognize this purchase or store product.", 402);
      throw new ComicServiceError("Google Play verification failed. Check the service account permissions and retry.", 503);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof ComicServiceError) throw error;
    throw new ComicServiceError("Google Play could not be reached. No paid access was granted.", 503);
  }
};

export function evaluatePurchase(subscription: GoogleSubscription, order: GoogleOrder | null,
  token: string, allowTest: boolean, now = Date.now()): VerifiedPurchase {
  const item = subscription.lineItems?.find(line => line.productId === PLAY_PRODUCT && line.offerDetails?.basePlanId === PLAY_PLAN);
  if (!item) throw new ComicServiceError("The receipt is not for Noir's monthly subscription.", 402);
  const expiry = new Date(item.expiryTime || 0);
  const orderId = item.latestSuccessfulOrderId || "";
  const state = subscription.subscriptionState || "SUBSCRIPTION_STATE_UNSPECIFIED";
  const entitled = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"].includes(state);
  const money = Number(order?.total?.units ?? 0) + Number(order?.total?.nanos ?? 0) / 1e9;
  // A free store trial, pending order, refund or client assertion never grants paid access.
  const paid = order?.state === "PROCESSED" && order.orderId === orderId &&
    order.purchaseToken === token && Number.isFinite(money) && money > 0;
  return {
    state, active: entitled && Number.isFinite(expiry.getTime()) && expiry.getTime() > now &&
      !!orderId && paid && (!subscription.testPurchase || allowTest) && !item.offerPhase?.freeTrial,
    expiresAt: Number.isFinite(expiry.getTime()) ? expiry : new Date(0), orderId,
    autoRenew: !!item.autoRenewingPlan?.autoRenewEnabled,
    linkedToken: subscription.linkedPurchaseToken,
    accountHash: subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId,
  };
}

export class PlayVerifier {
  constructor(private request: GoogleRequest = googleRequest, private allowTest = process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === "true") {}
  async catalog(requireActive = true) {
    const product = await this.request(`/monetization/subscriptions/${PLAY_PRODUCT}`);
    const plan = product.basePlans?.find((item: any) => item.basePlanId === PLAY_PLAN);
    const us = plan?.regionalConfigs?.find((region: any) => region.regionCode === "US");
    const price = Number(us?.price?.units ?? 0) + Number(us?.price?.nanos ?? 0) / 1e9;
    if (!(requireActive ? plan?.state === "ACTIVE" : ["ACTIVE", "INACTIVE"].includes(plan?.state)) || plan.autoRenewingBasePlanType?.billingPeriodDuration !== "P1M" ||
      us?.price?.currencyCode !== "USD" || Math.abs(price - 4.95) > 0.000001 || (requireActive && !us?.newSubscriberAvailability)) {
      throw new ComicServiceError("Google Play must have an active, auto-renewing monthly plan priced at USD $4.95.", 503);
    }
    return { usdPrice: "4.95", billingPeriod: "P1M", productId: PLAY_PRODUCT, basePlanId: PLAY_PLAN };
  }
  async verify(token: string): Promise<VerifiedPurchase> {
    const subscription = await this.request(`/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`) as GoogleSubscription;
    const item = subscription.lineItems?.find(line => line.productId === PLAY_PRODUCT && line.offerDetails?.basePlanId === PLAY_PLAN);
    if (!item) throw new ComicServiceError("The receipt is not for Noir's monthly subscription.", 402);
    const order = item.latestSuccessfulOrderId
      ? await this.request(`/orders/${encodeURIComponent(item.latestSuccessfulOrderId)}`) : null;
    const verified = evaluatePurchase(subscription, order, token, this.allowTest);
    if (verified.active && subscription.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      if (subscription.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING") throw new ComicServiceError("Google Play has not confirmed purchase acknowledgement.", 503);
      await this.request(`/purchases/subscriptions/${PLAY_PRODUCT}/tokens/${encodeURIComponent(token)}:acknowledge`, "POST", {});
    }
    return verified;
  }
}
export const playVerifier = new PlayVerifier();

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new ComicServiceError("Secure receipt storage is unavailable.", 503);
  return createHash("sha256").update(`noir-google-receipts-v1:${secret}`).digest();
}
export function encryptReceipt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}
export function decryptReceipt(value: string) {
  const parts = value.split(".").map(part => Buffer.from(part, "base64url"));
  if (parts.length !== 3) throw new Error("Invalid encrypted receipt");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), parts[0]!);
  decipher.setAuthTag(parts[1]!);
  return Buffer.concat([decipher.update(parts[2]!), decipher.final()]).toString("utf8");
}
async function persist(token: string, purchase: VerifiedPurchase) {
  const hash = digest(token);
  let accountKey = hash;
  if (purchase.linkedToken) {
    const previous = await pool.query("SELECT account_key FROM play_purchases WHERE token_hash=$1", [digest(purchase.linkedToken)]);
    accountKey = previous.rows[0]?.account_key || hash;
  }
  await pool.query(`INSERT INTO play_purchases
    (token_hash,encrypted_token,account_key,state,active,order_id,expires_at,auto_renew,verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (token_hash) DO UPDATE SET
    state=EXCLUDED.state,active=EXCLUDED.active,order_id=EXCLUDED.order_id,
    expires_at=EXCLUDED.expires_at,auto_renew=EXCLUDED.auto_renew,verified_at=NOW()`,
    [hash, encryptReceipt(token), accountKey, purchase.state, purchase.active, purchase.orderId, purchase.expiresAt, purchase.autoRenew]);
  return { tokenHash: hash, accountKey };
}
// Caller must first verify a receipt-specific Play Integrity proof emitted by
// native queryPurchasesAsync. Arbitrary JS cannot mint this proof for a stolen token.
export async function attachPurchase(customerId: string, token: string, verifier = playVerifier) {
  await verifier.catalog(false);
  const verified = await verifier.verify(token);
  const stored = await persist(token, verified);
  if (!verified.active) throw new ComicServiceError("Google Play has not verified a paid, unexpired subscription. No paid access was granted.", 402);
  await pool.query(`INSERT INTO play_devices (customer_id,token_hash)
    VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [customerId, stored.tokenHash]);
  return verified;
}
export async function googleMembership(customerId: string, verifier = playVerifier) {
  const receipts = await pool.query(`SELECT p.* FROM play_purchases p JOIN play_devices d
    ON d.token_hash=p.token_hash WHERE d.customer_id=$1 ORDER BY p.expires_at DESC LIMIT 5`, [customerId]);
  for (const row of receipts.rows) {
    try {
      const token = decryptReceipt(row.encrypted_token);
      const verified = await verifier.verify(token);
      await persist(token, verified);
      if (verified.active) return { subscribed: true, period: verified.orderId,
        accountId: row.account_key as string, expiresAt: verified.expiresAt.toISOString(), autoRenew: verified.autoRenew };
    } catch (error) {
      if (error instanceof ComicServiceError && error.status === 402) {
        await pool.query("UPDATE play_purchases SET active=false,state='UNRECOGNIZED',verified_at=NOW() WHERE token_hash=$1", [row.token_hash]);
        continue;
      }
      throw error;
    }
  }
  return { subscribed: false, period: "" };
}
export async function verifyPushIdentity(bearer: string) {
  const email = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new ComicServiceError("Google Play notification authentication is not configured.", 503);
  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: bearer, audience: process.env.GOOGLE_PLAY_RTDN_AUDIENCE || PLAY_AUDIENCE,
    });
    const claims = ticket.getPayload();
    if (!claims?.email_verified || claims.email !== email) throw new Error();
  } catch { throw new ComicServiceError("Unauthorized Google Play notification.", 401); }
}
export async function handlePlayNotification(messageId: string, payload: any) {
  if (payload.packageName !== PLAY_PACKAGE) throw new ComicServiceError("Wrong notification package.", 400);
  const seen = await pool.query("SELECT 1 FROM play_events WHERE message_id=$1", [messageId]);
  if (seen.rowCount) return;
  const token = payload.subscriptionNotification?.purchaseToken || payload.voidedPurchaseNotification?.purchaseToken;
  if (typeof token === "string") {
    const known = await pool.query("SELECT 1 FROM play_purchases WHERE token_hash=$1", [digest(token)]);
    if (known.rowCount) {
      try {
        const current = await playVerifier.verify(token);
        await persist(token, current);
      } catch (error) {
        if (!(error instanceof ComicServiceError) || error.status !== 402) throw error;
        await pool.query("UPDATE play_purchases SET active=false,state='UNRECOGNIZED',verified_at=NOW() WHERE token_hash=$1", [digest(token)]);
      }
    }
  }
  await pool.query("INSERT INTO play_events (message_id,processed_at) VALUES ($1,NOW()) ON CONFLICT DO NOTHING", [messageId]);
}
