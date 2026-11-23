import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../app";

test("desktop health and input validation do not require payments, device proofs or database access", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    for (const path of ["/comics/script", "/comics/generate", "/comics/jobs"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json() as { error: string }).error, "string");
    }
    const recording = await fetch(`${base}/comics/transcribe`, {
      method: "POST", headers: { "Content-Type": "audio/webm" }, body: new Uint8Array(),
    });
    assert.equal(recording.status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
