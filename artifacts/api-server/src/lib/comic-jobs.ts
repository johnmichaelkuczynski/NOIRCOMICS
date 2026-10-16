import { createHash, randomUUID } from "node:crypto";
import type { ComicGeneration, ComicJob } from "@workspace/api-zod";
import { ComicServiceError } from "./comic-providers";

type Entry = { keyHash: string; inputHash: string; job: ComicJob; finishedAt?: number };
const RETENTION_MS = 15 * 60_000;

// Temporary delivery buffer, not a saved comic library. Capacity includes completed
// results so images cannot accumulate without bound. Never store photos on disk.
export class ComicJobs {
  private entries = new Map<string, Entry>();

  constructor(private capacity = 8, private now = Date.now) {}

  private prune() {
    for (const [id, entry] of this.entries) {
      if (entry.finishedAt !== undefined && this.now() - entry.finishedAt >= RETENTION_MS) this.entries.delete(id);
    }
  }

  start(key: string, input: unknown, run: () => Promise<ComicGeneration>): ComicJob {
    this.prune();
    const keyHash = createHash("sha256").update(key).digest("hex");
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    for (const entry of this.entries.values()) {
      if (entry.keyHash !== keyHash) continue;
      if (entry.inputHash !== inputHash) throw new ComicServiceError("This request key was already used for different writing or photos.", 409);
      return entry.job;
    }
    if (this.entries.size >= this.capacity) throw new ComicServiceError("Comic generation is at capacity. Wait 15 minutes before starting another comic.", 503);
    const job: ComicJob = { id: randomUUID(), status: "pending" };
    const entry: Entry = { keyHash, inputHash, job };
    this.entries.set(job.id, entry);
    // Register before invoking work, so a repeated submission cannot reserve or
    // generate twice. Client disconnection does not cancel provider work.
    void Promise.resolve().then(run).then(comic => {
      entry.job = { id: job.id, status: "complete", comic };
    }, error => {
      entry.job = { id: job.id, status: "failed", error: error instanceof ComicServiceError
        ? error.message : "Comic generation failed. No comic was returned." };
    }).finally(() => { entry.finishedAt = this.now(); });
    return job;
  }

  get(id: string, key: string): ComicJob | undefined {
    this.prune();
    const entry = this.entries.get(id);
    return entry?.keyHash === createHash("sha256").update(key).digest("hex") ? entry.job : undefined;
  }
}
