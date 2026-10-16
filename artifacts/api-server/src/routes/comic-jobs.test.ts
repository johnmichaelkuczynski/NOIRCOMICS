import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import app from "../app";

test("HTTP job acceptance, duplicate protection, private polling, and final delivery use the real routes", async t => {
  // Run only with the documented fixture key; never send this test to a provider.
  assert.equal(process.env.VENICE_API_KEY, "fixture-only");
  const http = globalThis.fetch;
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFkAAAAAASUVORK5CYII=";
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let classificationCalls = 0;
  let imageCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(url).startsWith("https://api.venice.ai/"), "No other upstream or real network calls are allowed");
    if (String(url).endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      if (body.response_format.json_schema.name === "comic_content_category") {
        classificationCalls++;
        await pending;
        return Response.json({ choices: [{ message: { content: '{"category":"standard"}' } }] });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        title: "Route delivery", characterGuide: "Test",
        panels: [{ visualDescription: "Test explains an idea.", dialogue: "An idea." }],
      }) } }] });
    }
    imageCalls++;
    return new Response(Buffer.from(image, "base64"), { headers: { "Content-Type": "image/png" } });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/comics/jobs`;
  const key = randomUUID();
  const headers = { "Content-Type": "application/json", "X-Comic-Request-Key": key };
  const body = JSON.stringify({ text: "An idea.", panelCount: 1, provider: "venice",
    styleReferenceImage: `data:image/png;base64,${image}`,
    characterReferences: [{ characterName: "Test", imageDataUri: `data:image/png;base64,${image}` }] });
  const first = await http(base, { method: "POST", headers, body });
  assert.equal(first.status, 202);
  const job = await first.json() as { id: string; status: string };
  assert.equal(job.status, "pending");
  assert.equal(classificationCalls, 1);
  const duplicate = await http(base, { method: "POST", headers, body });
  assert.equal((await duplicate.json() as { id: string }).id, job.id);
  assert.equal(classificationCalls, 1);
  const forbidden = await http(`${base}/${job.id}`, { headers: { "X-Comic-Request-Key": randomUUID() } });
  assert.equal(forbidden.status, 404);
  const active = await http(`${base}/${job.id}`, { headers });
  assert.equal((await active.json() as { status: string }).status, "pending");
  release();
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  const completed = await http(`${base}/${job.id}`, { headers });
  const result = await completed.json() as { status: string; comic?: { title: string; panels: unknown[] } };
  assert.equal(result.status, "complete");
  assert.equal(result.comic?.title, "Route delivery");
  assert.equal(result.comic?.panels.length, 1);
  assert.equal(imageCalls, 1);
  assert.equal(completed.headers.get("cache-control"), "no-store");
});
