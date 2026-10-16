import test from "node:test";
import assert from "node:assert/strict";
import { ComicJobs } from "./comic-jobs";
import { ComicServiceError } from "./comic-providers";

const comic = { title: "Delivered", panels: [], providerUsed: "venice" as const, imageModel: "fixture" };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("accepts immediately, deduplicates concurrent requests, and retains the completed result", async () => {
  const jobs = new ComicJobs();
  let finish!: (value: typeof comic) => void;
  let calls = 0;
  const work = () => { calls++; return new Promise<typeof comic>(resolve => { finish = resolve; }); };
  const first = jobs.start("owner", { text: "same" }, work);
  const repeated = jobs.start("owner", { text: "same" }, work);
  assert.equal(first.status, "pending");
  assert.equal(first.id, repeated.id);
  await settle();
  assert.equal(calls, 1);
  assert.equal(jobs.get(first.id, "owner")?.status, "pending");
  assert.equal(jobs.get(first.id, "other"), undefined);
  finish(comic);
  await settle();
  assert.deepEqual(jobs.get(first.id, "owner")?.comic, comic);
  assert.equal(jobs.start("owner", { text: "same" }, work).status, "complete");
  assert.equal(calls, 1);
});

test("a reused key cannot silently substitute different input", () => {
  const jobs = new ComicJobs();
  jobs.start("owner", { text: "one" }, async () => comic);
  assert.throws(() => jobs.start("owner", { text: "two" }, async () => comic), { status: 409 });
});

test("provider errors survive background execution and polling", async () => {
  const jobs = new ComicJobs();
  const first = jobs.start("owner", {}, async () => { throw new ComicServiceError("Venice comic planning timed out before images were requested."); });
  await settle();
  assert.equal(jobs.get(first.id, "owner")?.status, "failed");
  assert.equal(jobs.get(first.id, "owner")?.error, "Venice comic planning timed out before images were requested.");
});

test("capacity is bounded and finished results expire without evicting active work", async () => {
  let now = 0;
  const jobs = new ComicJobs(1, () => now);
  const first = jobs.start("owner", {}, async () => comic);
  assert.throws(() => jobs.start("next", {}, async () => comic), { status: 503 });
  await settle();
  now = 15 * 60_000;
  assert.equal(jobs.get(first.id, "owner"), undefined);
  assert.equal(jobs.start("next", {}, async () => comic).status, "pending");
});
