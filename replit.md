# Noir Comic Generator

Converts a short essay or story into a selected number of black-and-white film-noir comic panels.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/noir-comic-generator run dev` — run the web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `OPENAI_API_KEY` — used only by the server, never exposed to the browser

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/api-server/src/lib/comic-generator.ts` — OpenAI text adaptation and reference-guided imagery
- `artifacts/noir-comic-generator/src/App.tsx` — text import, panel count and comic rendering
- `artifacts/noir-comic-generator/public/references/` — user-provided noir artwork used as the style reference

## Architecture decisions

- Dialogue is typeset as real text in balloons over artwork, rather than asking the image model to draw lettering. **Why:** comic lettering must stay accurate and readable.
- The first version has no accounts, saved-comics library, or database records. **Why:** the requested scope is a very simple text-to-panels app.
- Uses the user's OpenAI API key, not a keyless AI proxy. **Why:** the user specifically requested the ChatGPT API key.

## Product

- Paste text or import a `.txt` / `.md` file, up to 8,000 characters.
- Choose 1–24 panels, with eight convenient presets and a numeric control.
- Generate original photographic noir imagery guided by the supplied reference, with readable dialogue balloons.

## User preferences

- The user assumes short texts for now; short, information-dense writing may still need many panels.
- Match the provided photographic black-and-white noir comic style, rather than a generic illustrated comic style.
- Keep speech balloons compact and out of the way of faces and valuable imagery.

## Gotchas

- Image generation uses the user's OpenAI API balance and may take several minutes.
- Keep API credentials server-side and never log keys, source text, or image payloads.
- Re-run API codegen after contract changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
