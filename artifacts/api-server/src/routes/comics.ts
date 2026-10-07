import { Router, type IRouter } from "express";
import { GenerateComicBody, GenerateComicResponse } from "@workspace/api-zod";
import { createComic, ComicServiceError } from "../lib/comic-generator";

const router: IRouter = Router();

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
