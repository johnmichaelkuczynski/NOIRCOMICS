import { Router, type IRouter } from "express";
import { ComicServiceError } from "../lib/comic-providers";
import { issueSession, usage, BILLING_VERSION } from "../lib/billing";

const router: IRouter = Router();
router.post("/billing/session", (req, res) => {
  const deviceId = req.body?.deviceId;
  if (typeof deviceId !== "string" || !/^[a-f0-9]{64}$/.test(deviceId)) {
    res.status(400).json({ error: "A valid Android device identifier is required." });
    return;
  }
  try { res.json({ version: BILLING_VERSION, ...issueSession(deviceId) }); }
  catch { res.status(503).json({ error: "Secure billing is unavailable. Generation is blocked." }); }
});
router.get("/billing/usage", async (req, res) => {
  try { res.json(await usage(req)); }
  catch (error) {
    res.status(error instanceof ComicServiceError ? error.status : 503)
      .json({ error: error instanceof ComicServiceError ? error.message : "Usage verification is unavailable. Generation is blocked." });
  }
});
export default router;
