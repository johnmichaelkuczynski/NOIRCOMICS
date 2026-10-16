import { getComicJob, startComicJob, type ComicGeneration, type ComicGenerationInput, type ComicJob } from '@workspace/api-client-react';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function recoverable(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  return !status || status === 502 || status === 503 || status === 504;
}

export async function generateComicInBackground(data: ComicGenerationInput): Promise<ComicGeneration> {
  const key = crypto.randomUUID();
  const headers = { 'X-Comic-Request-Key': key };
  let job: ComicJob | undefined;
  // Only repeat acceptance using the SAME key; the server deduplicates it.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      job = await startComicJob(data, { headers, signal: AbortSignal.timeout(20_000) });
      break;
    } catch (error) {
      if (!recoverable(error) || attempt === 2) throw error;
      await pause(2_000);
    }
  }
  if (!job) throw new Error('The server did not acknowledge this generation. Do not immediately resubmit.');
  const deadline = Date.now() + 12 * 60_000;
  let consecutiveFailures = 0;
  while (true) {
    if (job.status === 'complete' && job.comic) return job.comic;
    if (job.status === 'failed') throw new Error(job.error || 'Comic generation failed.');
    if (Date.now() > deadline) throw new Error('Generation has not finished after 12 minutes. The server may still be working. Do not immediately submit a second comic.');
    await pause(2_000);
    try {
      job = await getComicJob(job.id, { headers, signal: AbortSignal.timeout(20_000) });
      consecutiveFailures = 0;
    } catch (error) {
      if (!recoverable(error)) throw error;
      consecutiveFailures++;
      if (consecutiveFailures >= 12) throw new Error('The browser could not reconnect to the comic server. Generation may still be running. Your writing and photos remain on this page; do not immediately resubmit.');
    }
  }
}
