import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { pool } from "@workspace/db";
import { ComicServiceError } from "./comic-providers";
import { digest, googleRequest, PLAY_PACKAGE } from "./google-play";

export type Purpose = "session" | "generation" | "receipt";
export function integrityConfiguration() {
  return {
    serviceCredentials: !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    projectNumber: process.env.GOOGLE_PLAY_CLOUD_PROJECT_NUMBER || "",
    signingCertificates: !!process.env.GOOGLE_PLAY_APP_SIGNING_SHA256,
    testPurchasesAllowed: process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === "true",
  };
}
export function expectedIntegrityHash(purpose: Purpose, nonce: string, deviceId: string, payload = "", path = "") {
  const canonical = purpose === "session" ? `session\n${nonce}\n${deviceId}`
    : purpose === "receipt" ? `receipt\n${nonce}\n${deviceId}\n${payload}`
    : `generation\n${nonce}\n${deviceId}\n${path}\n${payload}`;
  return createHash("sha256").update(canonical).digest("base64url");
}
export function checkIntegrityPayload(payload: any, expectedHash: string, certificates: string[], now = Date.now()) {
  const details = payload?.requestDetails;
  const app = payload?.appIntegrity;
  const timestamp = Number(details?.timestampMillis);
  if (details?.requestPackageName !== PLAY_PACKAGE || details?.requestHash !== expectedHash ||
    !Number.isFinite(timestamp) || Math.abs(now - timestamp) > 120_000 ||
    app?.packageName !== PLAY_PACKAGE || app?.appRecognitionVerdict !== "PLAY_RECOGNIZED" ||
    !/^\d+$/.test(String(app?.versionCode)) || Number(app.versionCode) < 3 ||
    !Array.isArray(app?.certificateSha256Digest) || !app.certificateSha256Digest.some((cert: string) => certificates.includes(cert)) ||
    !Array.isArray(payload?.deviceIntegrity?.deviceRecognitionVerdict) ||
    !payload.deviceIntegrity.deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY") ||
    payload?.accountDetails?.appLicensingVerdict !== "LICENSED") {
    throw new ComicServiceError("Google Play could not verify this app, device or request. No generation was authorized.", 403);
  }
}
export async function challenge(req: Request, purpose: Purpose, customerId?: string) {
  const configuration = integrityConfiguration();
  if (!configuration.serviceCredentials || !/^\d{6,20}$/.test(configuration.projectNumber) || !configuration.signingCertificates) {
    throw new ComicServiceError("Google Play service credentials, Cloud project number and app-signing certificate must be configured before this app can run safely.", 503);
  }
  const network = digest(req.ip || req.socket.remoteAddress || "unknown");
  const nonce = randomBytes(32).toString("hex");
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [network]);
    await connection.query("DELETE FROM play_challenges WHERE expires_at<NOW()");
    const rate = await connection.query("SELECT COUNT(*) AS n FROM play_challenges WHERE network=$1", [network]);
    if (Number(rate.rows[0]?.n) >= 20) throw new ComicServiceError("Too many billing requests. Wait briefly and try again.", 429);
    await connection.query(`INSERT INTO play_challenges (nonce_hash,purpose,customer_id,network,expires_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '3 minutes')`, [digest(nonce), purpose, customerId || null, network]);
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
  return { version: 3, nonce, cloudProjectNumber: configuration.projectNumber };
}
export async function consumeIntegrity(purpose: Purpose, nonce: unknown, token: unknown, deviceId: string,
  payload = "", path = "") {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce) ||
    typeof token !== "string" || token.length < 10 || token.length > 20_000 || !/^[a-f0-9]{64}$/.test(deviceId)) {
    throw new ComicServiceError("A fresh Google Play device proof is required.", 403);
  }
  const customerId = purpose === "session" ? null : `noir_${deviceId}`;
  const issued = await pool.query(`SELECT 1 FROM play_challenges WHERE nonce_hash=$1 AND purpose=$2
    AND customer_id IS NOT DISTINCT FROM $3 AND expires_at>NOW() AND consumed=false`, [digest(nonce), purpose, customerId]);
  if (!issued.rowCount) throw new ComicServiceError("The billing challenge expired or was already used. Retry the action.", 403);
  const result = await googleRequest("integrity:decode", "POST", { integrityToken: token });
  const configured = (process.env.GOOGLE_PLAY_APP_SIGNING_SHA256 || "").split(",").map(value => {
    const hex = value.trim().replaceAll(":", "");
    return /^[a-fA-F0-9]{64}$/.test(hex) ? Buffer.from(hex, "hex").toString("base64url") : value.trim().replace(/=+$/, "");
  }).filter(Boolean);
  if (!configured.length) throw new ComicServiceError("App-signing verification is unavailable.", 503);
  checkIntegrityPayload(result.tokenPayloadExternal, expectedIntegrityHash(purpose, nonce, deviceId, payload, path), configured);
  const used = await pool.query(`UPDATE play_challenges SET consumed=true WHERE nonce_hash=$1 AND purpose=$2
    AND customer_id IS NOT DISTINCT FROM $3 AND expires_at>NOW() AND consumed=false RETURNING nonce_hash`, [digest(nonce), purpose, customerId]);
  if (!used.rowCount) throw new ComicServiceError("This billing proof was already used.", 403);
}
export async function verifyGeneration(req: Request, customerId: string) {
  const bytes = Buffer.isBuffer(req.body) ? req.body : (req as Request & { rawBody?: Buffer }).rawBody;
  if (!bytes) throw new ComicServiceError("The generation request could not be verified.", 403);
  await consumeIntegrity("generation", req.get("X-Noir-Nonce"), req.get("X-Noir-Integrity"),
    customerId.slice(5), digest(bytes), req.originalUrl.split("?")[0]);
}
