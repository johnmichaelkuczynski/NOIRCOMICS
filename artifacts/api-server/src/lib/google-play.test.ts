import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { attachPurchase, decryptReceipt, digest, encryptReceipt, evaluatePurchase, googleMembership,
  PlayVerifier, PLAY_PLAN, PLAY_PRODUCT, type GoogleSubscription, type GoogleRequest } from "./google-play";
import { checkIntegrityPayload, expectedIntegrityHash } from "./play-integrity";
import { reserveCredits } from "./billing";

const token = `fixture-${randomUUID()}`;
const uid = `fixture-device-${randomUUID()}`;
const future = new Date(Date.now() + 86400_000).toISOString();
const subscription = (): GoogleSubscription => ({
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  lineItems: [{ productId: PLAY_PRODUCT, offerDetails: { basePlanId: PLAY_PLAN },
    expiryTime: future, latestSuccessfulOrderId: "fixture-paid-order",
    autoRenewingPlan: { autoRenewEnabled: true } }],
});
const paidOrder = () => ({ state: "PROCESSED", orderId: "fixture-paid-order", purchaseToken: token, total: { units: "4", nanos: 950000000 } });
const catalog = () => ({ basePlans: [{ basePlanId: PLAY_PLAN, state: "ACTIVE",
  autoRenewingBasePlanType: { billingPeriodDuration: "P1M" },
  regionalConfigs: [{ regionCode: "US", newSubscriberAvailability: true,
    price: { currencyCode: "USD", units: "4", nanos: 950000000 } }] }] });

for (const state of ["PENDING", "PAUSED", "ON_HOLD", "EXPIRED", "PENDING_PURCHASE_CANCELED", "UNSPECIFIED"]) {
  test(`${state} subscription cannot unlock generation`, () => {
    assert.equal(evaluatePurchase({ ...subscription(), subscriptionState: `SUBSCRIPTION_STATE_${state}` }, paidOrder(), token, false).active, false);
  });
}
for (const state of ["PENDING", "CANCELED", "PENDING_REFUND", "PARTIALLY_REFUNDED", "REFUNDED"]) {
  test(`${state} order cannot unlock paid access even with an active subscription`, () => {
    assert.equal(evaluatePurchase(subscription(), { ...paidOrder(), state }, token, false).active, false);
  });
}
test("active, genuinely paid order grants access", () => {
  assert.equal(evaluatePurchase(subscription(), paidOrder(), token, false).active, true);
});
test("cancellation keeps access only through the already-paid expiry", () => {
  const data = { ...subscription(), subscriptionState: "SUBSCRIPTION_STATE_CANCELED" };
  assert.equal(evaluatePurchase(data, paidOrder(), token, false).active, true);
  assert.equal(evaluatePurchase(data, paidOrder(), token, false, Date.now() + 2 * 86400_000).active, false);
});
test("grace period keeps the same successful order; it does not create another paid allowance", () => {
  const data = { ...subscription(), subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" };
  assert.equal(evaluatePurchase(data, paidOrder(), token, false).orderId, "fixture-paid-order");
});
test("zero-charge store trial never counts as verified payment", () => {
  assert.equal(evaluatePurchase(subscription(), { ...paidOrder(), total: { units: "0", nanos: 0 } }, token, false).active, false);
});
test("test purchases are denied unless license testing is explicitly enabled", () => {
  const data = { ...subscription(), testPurchase: {} };
  assert.equal(evaluatePurchase(data, paidOrder(), token, false).active, false);
  assert.equal(evaluatePurchase(data, paidOrder(), token, true).active, true);
});
test("mismatched order token cannot unlock another receipt", () => {
  assert.equal(evaluatePurchase(subscription(), { ...paidOrder(), purchaseToken: "another-fixture" }, token, false).active, false);
});
test("a stale successful order cannot unlock a new unpaid billing period", () => {
  assert.equal(evaluatePurchase(subscription(), { ...paidOrder(), orderId: "older-order" }, token, false).active, false);
});
test("wrong product and wrong base plan are rejected", () => {
  for (const item of [{ productId: "other", offerDetails: { basePlanId: PLAY_PLAN } },
    { productId: PLAY_PRODUCT, offerDetails: { basePlanId: "annual" } }]) {
    assert.throws(() => evaluatePurchase({ ...subscription(), lineItems: [item] }, paidOrder(), token, false), { status: 402 });
  }
});
test("paid, pending acknowledgement is acknowledged through the real Google endpoint shape", async () => {
  const calls: string[] = [];
  const request: GoogleRequest = async (path, method) => {
    calls.push(`${method || "GET"} ${path}`);
    if (path.includes(":acknowledge")) return {};
    if (path.includes("/orders/")) return paidOrder();
    return { ...subscription(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" };
  };
  assert.equal((await new PlayVerifier(request).verify(token)).active, true);
  assert.ok(calls.some(call => call === `POST /purchases/subscriptions/${PLAY_PRODUCT}/tokens/${token}:acknowledge`));
  assert.ok(calls.some(call => call === `GET /purchases/subscriptionsv2/tokens/${token}`));
});
test("Google API failure never produces a paid entitlement", async () => {
  await assert.rejects(new PlayVerifier(async () => { throw new Error("Google unavailable"); }).verify(token));
});
test("a Google acknowledgement failure does not activate paid access", async () => {
  await assert.rejects(new PlayVerifier(async path => {
    if (path.includes(":acknowledge")) throw new Error("Acknowledgement unavailable");
    if (path.includes("/orders/")) return paidOrder();
    return { ...subscription(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" };
  }).verify(token));
});
test("the catalog must be one month, USD 4.95 and active", async () => {
  assert.equal((await new PlayVerifier(async () => catalog()).catalog()).usdPrice, "4.95");
  for (const change of ["price", "duration", "inactive"]) {
    const data = catalog();
    if (change === "price") data.basePlans[0]!.regionalConfigs[0]!.price.units = "9";
    if (change === "duration") data.basePlans[0]!.autoRenewingBasePlanType.billingPeriodDuration = "P1Y";
    if (change === "inactive") data.basePlans[0]!.state = "DRAFT";
    await assert.rejects(new PlayVerifier(async () => data).catalog(), { status: 503 });
  }
});
test("receipt storage is encrypted and authenticated", () => {
  const encrypted = encryptReceipt(token);
  assert.ok(!encrypted.includes(token));
  assert.equal(decryptReceipt(encrypted), token);
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tamper").toString("base64url");
  assert.throws(() => decryptReceipt(parts.join(".")));
});
test("existing paid subscriptions can be restored after new subscriptions are disabled", async () => {
  const data = catalog();
  data.basePlans[0]!.state = "INACTIVE";
  data.basePlans[0]!.regionalConfigs[0]!.newSubscriberAvailability = false;
  const verifier = new PlayVerifier(async () => data);
  assert.equal((await verifier.catalog(false)).usdPrice, "4.95");
  await assert.rejects(verifier.catalog(), { status: 503 });
});
function integrity() {
  return { requestDetails: { requestPackageName: "nk.noircomicgen2.app", requestHash: "fixture-hash", timestampMillis: String(Date.now()) },
    appIntegrity: { packageName: "nk.noircomicgen2.app", appRecognitionVerdict: "PLAY_RECOGNIZED", versionCode: "4", certificateSha256Digest: ["fixture-cert"] },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
    accountDetails: { appLicensingVerdict: "LICENSED" } };
}
test("licensed, recognized app/device and bound request pass attestation policy", () => {
  checkIntegrityPayload(integrity(), "fixture-hash", ["fixture-cert"]);
});
for (const tamper of ["hash", "package", "certificate", "old-version", "license", "device", "timestamp"]) {
  test(`attestation rejects tampered ${tamper}`, () => {
    const data = integrity();
    if (tamper === "hash") data.requestDetails.requestHash = "forged";
    if (tamper === "package") data.appIntegrity.packageName = "another.app";
    if (tamper === "certificate") data.appIntegrity.certificateSha256Digest = ["forged"];
    if (tamper === "old-version") data.appIntegrity.versionCode = "2";
    if (tamper === "license") data.accountDetails.appLicensingVerdict = "UNLICENSED";
    if (tamper === "device") data.deviceIntegrity.deviceRecognitionVerdict = [];
    if (tamper === "timestamp") data.requestDetails.timestampMillis = "1";
    assert.throws(() => checkIntegrityPayload(data, "fixture-hash", ["fixture-cert"]), { status: 403 });
  });
}
test("proof hashes cannot be moved between receipt, device, generation path or body", () => {
  const hash = expectedIntegrityHash("generation", "nonce", "device", "body", "/api/comics/generate");
  assert.notEqual(hash, expectedIntegrityHash("receipt", "nonce", "device", "body"));
  assert.notEqual(hash, expectedIntegrityHash("generation", "nonce", "other-device", "body", "/api/comics/generate"));
  assert.notEqual(hash, expectedIntegrityHash("generation", "nonce", "device", "other-body", "/api/comics/generate"));
  assert.notEqual(hash, expectedIntegrityHash("generation", "nonce", "device", "body", "/api/comics/script"));
});
const databaseTestsEnabled = process.env.NOIR_BILLING_DB_TESTS === "true" && process.env.NODE_ENV === "development";
test("verified restore shares one quota across devices; renewal and refund update entitlements", { skip: !databaseTestsEnabled }, async () => {
  let state = subscription();
  let order = paidOrder();
  const verifier = new PlayVerifier(async path => path.includes("/monetization/") ? catalog()
    : path.includes("/orders/") ? order : state);
  await attachPurchase(uid, token, verifier);
  await attachPurchase(`${uid}-restored`, token, verifier);
  const first = await googleMembership(uid, verifier);
  const restored = await googleMembership(`${uid}-restored`, verifier);
  assert.equal(first.subscribed, true);
  assert.equal(first.accountId, restored.accountId);
  const used = await reserveCredits({ customerId: uid, native: true, network: uid }, first, "panels", 24);
  await used.finish(24);
  await assert.rejects(reserveCredits({ customerId: `${uid}-restored`, native: true, network: uid }, restored, "panels", 1), { status: 402 });
  state = subscription();
  state.lineItems![0]!.latestSuccessfulOrderId = "fixture-renewal-order";
  order = { ...order, orderId: "fixture-renewal-order" };
  const renewed = await googleMembership(uid, verifier);
  assert.notEqual(renewed.period, first.period);
  const next = await reserveCredits({ customerId: uid, native: true, network: uid }, renewed, "panels", 1);
  await next.finish(1);
  order = { ...order, state: "REFUNDED" };
  assert.equal((await googleMembership(uid, verifier)).subscribed, false);
});
after(async () => {
  if (!databaseTestsEnabled) { await pool.end(); return; }
  await pool.query("DELETE FROM play_devices WHERE token_hash=$1", [digest(token)]);
  await pool.query("DELETE FROM play_purchases WHERE token_hash=$1", [digest(token)]);
  await pool.query("DELETE FROM billing_usage WHERE key LIKE $1", [`paid:${digest(token)}:%`]);
  await pool.end();
});
