import test from "node:test";
import assert from "node:assert/strict";
import { GenerateComicBody } from "@workspace/api-zod";
import { characterReferencePrompt, validateCharacterReferences } from "./character-references";
import { createComic } from "./comic-generator";
import { VENICE_CHARACTER_MODEL, VENICE_IMAGE_MODEL } from "./comic-providers";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFkAAAAAASUVORK5CYII=";
const imageDataUri = `data:image/png;base64,${png}`;
const names = ["Sigmund", "Anna", "Carl", "Melanie"];
const photos = names.map(characterName => ({ characterName, imageDataUri, instructions: "Keep the face recognizable." }));
const input = { text: "Sigmund and Anna talk to Carl and Melanie.", panelCount: 2, styleReferenceImage: imageDataUri };

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
  assert.match(prompt, /"imageNumber":2,"characterName":"Sigmund"/);
  assert.match(prompt, /"imageNumber":3,"characterName":"Sigmund"/);
  assert.match(prompt, /Image 1 is ONLY the noir aesthetic/);
  assert.equal(characterReferencePrompt([]), "");
});

for (const provider of ["openai", "venice"] as const) {
  test(`${provider}: every panel receives all four photo bytes and named assignments`, async t => {
    const oldOpenAI = process.env.OPENAI_API_KEY;
    const oldVenice = process.env.VENICE_API_KEY;
    process.env.OPENAI_API_KEY = "fixture-only";
    process.env.VENICE_API_KEY = "fixture-only";
    const imageCalls: RequestInit[] = [];
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        if (body.model === "gpt-4.1-mini") return Response.json({ choices: [{ message: { content: '{"category":"standard"}' } }] });
        assert.match(body.messages[1].content, /Sigmund/);
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          title: "Four characters", characterGuide: names.join(", "),
          panels: [1, 2].map(() => ({ visualDescription: "The four named characters talk.", dialogue: "Let us discuss this." })),
        }) } }] });
      }
      imageCalls.push(init!);
      urls.push(path);
      return provider === "openai" ? Response.json({ data: [{ b64_json: png }] })
        : new Response(Buffer.from(png, "base64"), { headers: { "Content-Type": "image/png" } });
    });
    try {
      const result = await createComic({ ...input, provider, characterReferences: photos });
      assert.equal(result.panels.length, 2);
      assert.equal(imageCalls.length, 2);
      for (const call of imageCalls) {
        if (provider === "openai") {
          const form = call.body as FormData;
          const images = form.getAll("image[]") as File[];
          assert.equal(images.length, 5);
          for (const image of images) assert.equal(Buffer.from(await image.arrayBuffer()).toString("base64"), png);
          for (const name of names) assert.ok(String(form.get("prompt")).includes(name));
        } else {
          const body = JSON.parse(String(call.body));
          assert.deepEqual(body.images, Array(5).fill(png));
          assert.equal(body.modelId, VENICE_CHARACTER_MODEL);
          assert.equal(body.safe_mode, true);
          for (const name of names) assert.ok(body.prompt.includes(name));
        }
      }
      assert.ok(urls.every(url => url.endsWith(provider === "openai" ? "/images/edits" : "/image/multi-edit")));
      assert.equal(result.imageModel, provider === "venice" ? VENICE_CHARACTER_MODEL : "gpt-image-1");
      if (provider === "venice") {
        imageCalls.length = 0; urls.length = 0;
        const ordinary = await createComic({ ...input, provider });
        assert.equal(ordinary.imageModel, VENICE_IMAGE_MODEL);
        assert.ok(urls.every(url => url.endsWith("/image/edit")));
        assert.ok(imageCalls.every(call => !("images" in JSON.parse(String(call.body)))));
      }
    } finally {
      if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
      if (oldVenice === undefined) delete process.env.VENICE_API_KEY; else process.env.VENICE_API_KEY = oldVenice;
    }
  });
}
