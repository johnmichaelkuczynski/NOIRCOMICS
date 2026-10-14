import { setTimeout as delay } from "node:timers/promises";
import { ComicServiceError } from "./comic-providers";
import { logger } from "./logger";

const ASSEMBLY_BASE_URL = "https://api.assemblyai.com/v2";
export const AUDIO_TYPES = [
  "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg",
  "audio/ogg", "audio/aac", "video/webm", "video/mp4",
];

async function assemblyJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ComicServiceError("AssemblyAI rejected the API key or account access. Check the ASSEMBLYAI_API_KEY Secret and account permissions.");
    }
    if (response.status === 402) throw new ComicServiceError("AssemblyAI requires additional transcription credits.");
    if (response.status === 429) throw new ComicServiceError("AssemblyAI's rate or usage limit was reached. Wait and retry transcription.");
    throw new ComicServiceError("AssemblyAI could not process the recording. Retry transcription or record again.", response.status === 400 ? 400 : 502);
  }
  return await response.json() as Record<string, unknown>;
}

export async function transcribeRecording(audio: Buffer, requestSignal: AbortSignal) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new ComicServiceError("Add ASSEMBLYAI_API_KEY through Replit Secrets to enable dictation.");
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(180_000)]);
  const authorization = { authorization: key };
  let transcriptId: string | undefined;
  try {
    const upload = await assemblyJson(await fetch(`${ASSEMBLY_BASE_URL}/upload`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(audio),
      signal,
    }));
    if (typeof upload.upload_url !== "string" || !upload.upload_url.startsWith("https://")) {
      throw new ComicServiceError("AssemblyAI did not accept the recording. Retry transcription.");
    }
    let result = await assemblyJson(await fetch(`${ASSEMBLY_BASE_URL}/transcript`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: upload.upload_url, audio_end_at: 300_000, language_detection: true, punctuate: true, format_text: true }),
      signal,
    }));
    if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)) {
      throw new ComicServiceError("AssemblyAI did not start transcription. Retry transcription.");
    }
    transcriptId = result.id;
    while (result.status === "queued" || result.status === "processing") {
      await delay(1500, undefined, { signal });
      result = await assemblyJson(await fetch(`${ASSEMBLY_BASE_URL}/transcript/${transcriptId}`, {
        headers: authorization, signal,
      }));
    }
    if (result.status !== "completed") {
      const reason = typeof result.error === "string" ? result.error : "";
      throw new ComicServiceError(/no.*speech|too short|silence/i.test(reason)
        ? "No speech was detected. Record again and speak clearly."
        : "AssemblyAI could not transcribe this recording. Retry transcription or record again.", 400);
    }
    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) throw new ComicServiceError("No speech was detected. Record again and speak clearly.", 400);
    if (text.length > 8000) throw new ComicServiceError("This dictation exceeds the 8,000-character input limit. Please make a shorter recording.", 400);
    return { text, provider: "assemblyai" as const };
  } finally {
    // No audio or transcript is written to our filesystem/database. Request vendor cleanup too.
    if (transcriptId) {
      try {
        const cleanup = await fetch(`${ASSEMBLY_BASE_URL}/transcript/${transcriptId}`, {
          method: "DELETE", headers: authorization, signal: AbortSignal.timeout(8_000),
        });
        if (!cleanup.ok) logger.warn({ provider: "assemblyai", status: cleanup.status }, "Transcription cleanup was not accepted");
      } catch {
        logger.warn({ provider: "assemblyai" }, "Transcription cleanup could not be completed");
      }
    }
  }
}
