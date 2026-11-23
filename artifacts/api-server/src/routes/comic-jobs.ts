import { Router, type IRouter } from "express";
import { GenerateComicBody, GenerateComicResponse, GetComicJobResponse, StartComicJobResponse } from "@workspace/api-zod";
import { ComicJobs } from "../lib/comic-jobs";
import { createComic, ComicServiceError } from "../lib/comic-generator";

const router: IRouter = Router();
const jobs = new ComicJobs();
const validKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

router.post("/comics/jobs", (req, res): void => {
  res.set("Cache-Control", "no-store");
  const input = GenerateComicBody.safeParse(req.body);
  const key = req.get("X-Comic-Request-Key") ?? "";
  if (!input.success || !input.data.text.trim() || !validKey(key)) {
    res.status(400).json({ error: "Enter writing, choose 1–24 panels, and use no more than four named JPEG, PNG or WebP character photos." });
    return;
  }
  try {
    const job = jobs.start(key, input.data, async () => {
      const started = Date.now();
      req.log.info({ panelCount: input.data.panelCount, characterPhotoCount: input.data.characterReferences?.length ?? 0 }, "Comic background generation started");
      try {
        const comic = GenerateComicResponse.parse(await createComic(input.data));
        req.log.info({ elapsedMs: Date.now() - started }, "Comic background generation completed");
        return comic;
      } catch (error) {
        req.log.error({ elapsedMs: Date.now() - started, errorType: error instanceof Error ? error.name : "unknown",
          message: error instanceof ComicServiceError ? error.message : "Comic generation failed" }, "Comic background generation failed");
        throw error;
      }
    });
    res.status(202).json(StartComicJobResponse.parse(job));
  } catch (error) {
    res.status(error instanceof ComicServiceError ? error.status : 500).json({
      error: error instanceof ComicServiceError ? error.message : "Could not start comic generation.",
    });
  }
});

router.get("/comics/jobs/:jobId", (req, res): void => {
  res.set("Cache-Control", "no-store");
  const key = req.get("X-Comic-Request-Key") ?? "";
  const job = validKey(key) ? jobs.get(String(req.params.jobId), key) : undefined;
  if (!job) {
    res.status(404).json({ error: "This generation is no longer available. The server may have restarted or the result expired. Your writing and photos remain on this page." });
    return;
  }
  res.json(GetComicJobResponse.parse(job));
});

export default router;
