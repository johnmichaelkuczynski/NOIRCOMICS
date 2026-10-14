import { Router, type IRouter } from "express";
import { ComicServiceError } from "../lib/comic-providers";
import { identify, issueSession, usage, BILLING_VERSION } from "../lib/billing";
import { challenge, consumeIntegrity, integrityConfiguration, type Purpose } from "../lib/play-integrity";
import { attachPurchase, digest, handlePlayNotification, playVerifier, verifyPushIdentity } from "../lib/google-play";

const router: IRouter = Router();
function fail(res: import("express").Response, error: unknown) {
  res.status(error instanceof ComicServiceError ? error.status : 503)
    .json({ error: error instanceof ComicServiceError ? error.message : "Billing verification is unavailable. No access was granted." });
}
router.get("/billing/config", (_req, res) => {
  res.json({ version: BILLING_VERSION, ...integrityConfiguration() });
});
router.get("/billing/challenge", async (req, res) => {
  const purpose = req.query.purpose as Purpose;
  if (!["session", "generation", "receipt"].includes(purpose)) {
    res.status(400).json({ error: "Specify a valid billing operation." }); return;
  }
  try {
    const identity = purpose === "session" ? undefined : identify(req);
    if (identity && !identity.native) throw new ComicServiceError("An authenticated Android session is required.", 401);
    res.json(await challenge(req, purpose, identity?.customerId));
  } catch (error) { fail(res, error); }
});
router.post("/billing/session", async (req, res) => {
  const deviceId = req.body?.deviceId;
  if (typeof deviceId !== "string" || !/^[a-f0-9]{64}$/.test(deviceId)) {
    res.status(400).json({ error: "A valid Android device identifier is required." });
    return;
  }
  try {
    await consumeIntegrity("session", req.body.nonce, req.body.integrityToken, deviceId);
    res.json({ version: BILLING_VERSION, ...issueSession(deviceId) });
  } catch (error) { fail(res, error); }
});
router.get("/billing/usage", async (req, res) => {
  try { res.json(await usage(req)); }
  catch (error) { fail(res, error); }
});
router.get("/billing/catalog", async (req, res) => {
  try {
    if (!identify(req).native) throw new ComicServiceError("An authenticated Android session is required.", 401);
    res.json(await playVerifier.catalog());
  } catch (error) { fail(res, error); }
});
router.post("/billing/verify", async (req, res) => {
  try {
    const identity = identify(req);
    if (!identity.native) throw new ComicServiceError("An authenticated Android session is required.", 401);
    const token = req.body?.purchaseToken;
    if (typeof token !== "string" || token.length < 5 || token.length > 8192) {
      throw new ComicServiceError("A Google Play purchase token is required.", 400);
    }
    await consumeIntegrity("receipt", req.body.nonce, req.body.integrityToken, identity.customerId.slice(5), digest(token));
    const verified = await attachPurchase(identity.customerId, token);
    res.json({ verified: true, subscribed: true, expiresAt: verified.expiresAt.toISOString(), autoRenew: verified.autoRenew });
  } catch (error) { fail(res, error); }
});
router.post("/billing/google-play/notifications", async (req, res) => {
  try {
    const authorization = req.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new ComicServiceError("Authenticated Google Pub/Sub delivery is required.", 401);
    await verifyPushIdentity(authorization.slice(7));
    const message = req.body?.message;
    if (typeof message?.messageId !== "string" || message.messageId.length > 200 ||
      typeof message?.data !== "string" || message.data.length > 30_000) throw new ComicServiceError("Invalid Google Play notification.", 400);
    const payload = JSON.parse(Buffer.from(message.data, "base64").toString("utf8"));
    await handlePlayNotification(message.messageId, payload);
    res.status(204).end();
  } catch (error) { fail(res, error); }
});
export default router;
