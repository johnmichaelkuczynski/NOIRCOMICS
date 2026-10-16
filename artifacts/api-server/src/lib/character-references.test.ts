import test from "node:test";
import assert from "node:assert/strict";
import { GenerateComicBody } from "@workspace/api-zod";
import { characterReferencePrompt, validateCharacterReferences } from "./character-references";
import { createComic } from "./comic-generator";
import { VENICE_CHARACTER_MODEL, VENICE_IMAGE_MODEL, VENICE_VISION_MODEL } from "./comic-providers";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFkAAAAAASUVORK5CYII=";
const imageDataUri = `data:image/png;base64,${png}`;
const stylePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAIBKwr76AAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==";
const names = ["Sigmund", "Anna", "Carl", "Melanie"];
const photos = names.map(characterName => ({ characterName, imageDataUri, instructions: "Keep the face recognizable." }));
const input = { text: "Sigmund and Anna talk to Carl and Melanie.", panelCount: 2, styleReferenceImage: `data:image/png;base64,${stylePng}` };

test("references are optional and four named photos are accepted", () => {
  assert.deepEqual(validateCharacterReferences(), []);
  assert.equal(validateCharacterReferences(photos).length, 4);
  assert.equal(GenerateComicBody.safeParse({ ...input, characterReferences: photos }).success, true);
});
test("both API contract and direct generator validation reject a fifth photo", () => {
  const five = [...photos, photos[0]!];
  assert.equal(GenerateComicBody.safeParse({ ...input, characterReferences: five }).success, false);
  assert.throws(() => validateCharacterReferences(five), { status: 400 });
});
test("invalid names, oversized instructions, oversized images, URLs and spoofed images are rejected", () => {
  for (const bad of [
    { ...photos[0]!, characterName: "  " },
    { ...photos[0]!, characterName: "x".repeat(81) },
    { ...photos[0]!, instructions: "x".repeat(301) },
    { ...photos[0]!, imageDataUri: `data:image/jpeg;base64,${"A".repeat(2_000_000)}` },
    { ...photos[0]!, imageDataUri: "https://example.com/photo.png" },
    { ...photos[0]!, imageDataUri: `data:image/jpeg;base64,${png}` },
    { ...photos[0]!, imageDataUri: "data:image/svg+xml;base64,PHN2Zy8+" },
  ]) assert.throws(() => validateCharacterReferences([bad]), { status: 400 });
});
test("mapping preserves array order, keeps style separate, and allows several photos of one character", () => {
  const mapped = validateCharacterReferences([{ ...photos[0]!, characterName: " Sigmund " }, photos[0]!]);
  assert.equal(mapped[0]!.characterName, "Sigmund");
  const prompt = characterReferencePrompt(mapped);
  assert.match(prompt, /"imageNumber":1,"characterName":"Sigmund"/);
  assert.match(prompt, /"imageNumber":2,"characterName":"Sigmund"/);
  assert.match(prompt, /Image 3 \(the LAST image\) is ONLY the noir aesthetic/);
  assert.match(prompt, /IDENTITY HAS PRIORITY/);
  assert.match(prompt, /if it disagrees, follow the photo/);
  assert.equal(characterReferencePrompt([]), "");
});

for (const provider of ["openai", "venice", "auto"] as const) {
  test(`${provider}: photos are read and illustrated exclusively by Venice, identity inputs first`, async t => {
    const oldOpenAI = process.env.OPENAI_API_KEY;
    const oldVenice = process.env.VENICE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.VENICE_API_KEY = "fixture-only";
    const imageCalls: RequestInit[] = [];
    const urls: string[] = [];
    let outlineCalls = 0;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      assert.ok(path.startsWith("https://api.venice.ai/"), "Photo-assisted generation must never call OpenAI");
      if (path.includes("/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, VENICE_VISION_MODEL);
        if (body.response_format.json_schema.name === "comic_content_category") return Response.json({ choices: [{ message: { content: '{"category":"standard"}' } }] });
        outlineCalls++;
        const parts = body.messages[1].content;
        assert.ok(Array.isArray(parts), "The outline writer must actually see the photographs");
        assert.deepEqual(parts.filter((part: { type: string }) => part.type === "image_url").map((part: { image_url: { url: string } }) => part.image_url.url), photos.map(photo => photo.imageDataUri));
        const text = parts.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n");
        for (const name of names) assert.ok(text.includes(name));
        assert.match(body.messages[0].content, /cast that person as the primary presenter/);
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          title: "Four characters", characterGuide: names.join(", "),
          panels: [1, 2].map(() => ({ visualDescription: "The four named characters talk.", dialogue: "Let us discuss this." })),
        }) } }] });
      }
      imageCalls.push(init!);
      urls.push(path);
      return new Response(Buffer.from(png, "base64"), { headers: { "Content-Type": "image/png" } });
    });
    try {
      const result = await createComic({ ...input, provider, characterReferences: photos });
      assert.equal(result.panels.length, 2);
      assert.equal(imageCalls.length, 2);
      assert.equal(outlineCalls, 1);
      for (const call of imageCalls) {
        const body = JSON.parse(String(call.body));
        assert.deepEqual(body.images, [...Array(4).fill(png), stylePng]);
        assert.equal(body.modelId, VENICE_CHARACTER_MODEL);
        assert.equal(body.safe_mode, true);
        assert.match(body.prompt, /Image 5 \(the LAST image\)/);
        for (const name of names) assert.ok(body.prompt.includes(name));
      }
      assert.ok(urls.every(url => url.endsWith("/image/multi-edit")));
      assert.equal(result.providerUsed, "venice");
      assert.equal(result.imageModel, VENICE_CHARACTER_MODEL);
    } finally {
      if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
      if (oldVenice === undefined) delete process.env.VENICE_API_KEY; else process.env.VENICE_API_KEY = oldVenice;
    }
  });
}

for (const provider of ["openai", "venice"] as const) {
  test(`${provider}: ordinary no-photo comics keep their existing models and text-only outline`, async t => {
    const oldOpenAI = process.env.OPENAI_API_KEY;
    const oldVenice = process.env.VENICE_API_KEY;
    process.env.OPENAI_API_KEY = "fixture-only";
    process.env.VENICE_API_KEY = "fixture-only";
    let imageCalls = 0;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/chat/completions")) {
        assert.ok(path.startsWith("https://api.openai.com/"));
        const body = JSON.parse(String(init?.body));
        assert.equal(typeof body.messages[1].content, "string");
        if (body.model === "gpt-4.1-mini") return Response.json({ choices: [{ message: { content: '{"category":"standard"}' } }] });
        assert.equal(body.model, "gpt-4.1");
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          title: "An ordinary comic", characterGuide: "Two speakers.",
          panels: [1, 2].map(() => ({ visualDescription: "Two people discuss an idea.", dialogue: "Let us discuss this." })),
        }) } }] });
      }
      imageCalls++;
      if (provider === "venice") {
        assert.ok(path.endsWith("/image/edit"));
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, VENICE_IMAGE_MODEL);
        assert.equal(body.image, stylePng);
        assert.equal(body.images, undefined);
        return new Response(Buffer.from(png, "base64"), { headers: { "Content-Type": "image/png" } });
      }
      assert.ok(path.endsWith("/images/edits"));
      const form = init?.body as FormData;
      assert.equal(form.get("model"), "gpt-image-1");
      assert.equal(form.getAll("image[]").length, 1);
      assert.equal(form.get("input_fidelity"), null);
      return Response.json({ data: [{ b64_json: png }] });
    });
    try {
      const result = await createComic({ ...input, provider });
      assert.equal(result.providerUsed, provider);
      assert.equal(imageCalls, 2);
    } finally {
      if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
      if (oldVenice === undefined) delete process.env.VENICE_API_KEY; else process.env.VENICE_API_KEY = oldVenice;
    }
  });
}

test("photo-assisted generation fails explicitly without a Venice key; it never falls back to OpenAI", async t => {
  const previous = process.env.VENICE_API_KEY;
  delete process.env.VENICE_API_KEY;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider should be called"); });
  try {
    await assert.rejects(createComic({ ...input, provider: "openai", characterReferences: photos }), /VENICE_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.VENICE_API_KEY = previous;
  }
});
