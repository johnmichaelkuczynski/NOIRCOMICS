import { Router, raw, type IRouter } from "express";
import { GenerateComicBody, GenerateComicResponse, GetComicProvidersResponse, WriteComicScriptBody, WriteComicScriptResponse, TranscribeComicAudioResponse } from "@workspace/api-zod";
import { createComic, ComicServiceError } from "../lib/comic-generator";
import { getComicProviderStatus } from "../lib/comic-providers";
import { developStoryIdea } from "../lib/script-writer";
import { AUDIO_TYPES, transcribeRecording } from "../lib/dictation";

const router: IRouter = Router();
const parseAudio = raw({ type: [...AUDIO_TYPES], limit: "12mb" });

router.post("/comics/script", async (req, res): Promise<void> => {
  const input = WriteComicScriptBody.safeParse(req.body);
  if (!input.success || !input.data.idea.trim()) {
    res.status(400).json({ error: "Describe a story idea using up to 8,000 characters and choose 1–24 panels." });
    return;
  }
  try {
    res.json(WriteComicScriptResponse.parse(await developStoryIdea(input.data.idea, input.data.panelCount, input.data.previousScript)));
  } catch (error) {
    const status = error instanceof ComicServiceError ? error.status : 500;
    const message = error instanceof ComicServiceError ? error.message : "Script writing failed. Your idea is unchanged; please try again.";
    req.log.error({ status, message }, "Script writing failed");
    res.status(status).json({ error: message });
  }
});

router.post("/comics/transcribe", (req, res, next) => {
  parseAudio(req, res, (error: unknown) => {
    if (error) {
      const tooLarge = (error as { type?: string }).type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge
        ? "The recording is too large. Please make a shorter recording."
        : "The recording could not be received. Retry transcription." });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  const mime = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (!AUDIO_TYPES.includes(mime)) {
    res.status(415).json({ error: "This recording format is not supported. Try dictating in an updated browser." });
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "The recording was empty. Record again and speak clearly." });
    return;
  }
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", cancel);
  try {
    const transcript = await transcribeRecording(req.body, controller.signal);
    if (!res.destroyed) res.json(TranscribeComicAudioResponse.parse(transcript));
  } catch (error) {
    if (res.destroyed) return;
    const status = error instanceof ComicServiceError ? error.status : 500;
    const message = error instanceof ComicServiceError ? error.message : "Transcription did not complete. Your recording is still available on this page for retry.";
    req.log.error({ status, message }, "Dictation failed");
    res.status(status).json({ error: message });
  } finally {
    res.off("close", cancel);
  }
});

router.get("/comics/providers", async (_req, res): Promise<void> => {
  res.json(GetComicProvidersResponse.parse(await getComicProviderStatus()));
});

router.post("/comics/generate", async (req, res): Promise<void> => {
  const input = GenerateComicBody.safeParse(req.body);
  if (!input.success || !input.data.text.trim()) {
    res.status(400).json({ error: "Enter a short text and choose between 1 and 24 panels." });
    return;
  }

  try {
    const comic = await createComic(input.data);
    res.json(GenerateComicResponse.parse(comic));
  } catch (error) {
    const status = error instanceof ComicServiceError ? error.status : 500;
    const message = error instanceof ComicServiceError
      ? error.message
      : "Comic generation failed. Please try again.";
    req.log.error({ status, message }, "Comic generation failed");
    res.status(status).json({ error: message });
  }
});

export default router;
