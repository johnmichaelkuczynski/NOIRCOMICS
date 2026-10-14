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
- Required for Venice images: `VENICE_API_KEY` — collected through the secure Secrets form and used server-side only
- Required for dictation: `ASSEMBLYAI_API_KEY` — used server-side only

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
- OpenAI prepares faithful dialogue for both image providers; Venice handles reference-guided images when selected. **Why:** retain the established text-adaptation quality while offering a second image provider.
- Automatic routing sends supported non-explicit mature themes to Venice and ordinary content to OpenAI. Explicit sexual content is rejected before adaptation or image requests; Venice safe mode stays enabled. **Why:** the integration's agreed scope is non-explicit content, not a pornography mode or safety bypass.
- Dictation uses AssemblyAI, not OpenAI transcription or browser-only speech recognition. **Why:** the user explicitly chose AssemblyAI and wants voice entry suitable for an eventual phone app.
- Developing an idea into a new script is a separate action from faithfully adapting existing writing into comic panels. Script-only generation never requests images. **Why:** the user wants to review a script and independently choose whether to make comics.
- Script regeneration reuses the idea captured when that script was created, not the input's current contents. **Why:** the user wants another version without retyping or redictating, even if the input has since changed. Keep the existing draft until its replacement succeeds.

## Product

- Paste text or import a `.txt` / `.md` file, up to 8,000 characters.
- Choose 1–24 panels, with eight convenient presets and a numeric control.
- Generate original photographic noir imagery guided by the supplied reference, with readable dialogue balloons.
- Choose “ChatGPT — SFW” (the default) or “Venice — Mature” (non-explicit themes); Automatic routing remains available. See the actual image provider used in the result.
- Venice connectivity is checked against its authenticated rate-limit/access endpoint and model catalog. No credentials or balances are returned to the browser.
- Dictate into the existing input, stop to transcribe, edit the words, and retry failed transcription without recording again. Recordings are capped at five minutes/12 MB and held temporarily, not saved by this app.
- Develop an arbitrary story idea into an editable, downloadable script. The original idea remains intact; a separate button generates comics from the edited script using the selected panel count and provider.
- “Create new version” requests a different script from the same original idea, uses the current panel count, and never automatically generates images.

## User preferences

- Keep the approved PC app unchanged while creating a separate Android version.
  **Why:** the user explicitly approved the PC version and requested an Android
  companion as a Google Play `.aab`, not a replacement desktop interface.
- Deliver the Android `.aab` as a downloadable file. Do not publish or submit
  it to Google Play. **Why:** the user explicitly said they will upload it
  themselves and corrected explanations about publishing that delayed delivery.
- Android monetization: free installation and limited free generation, then a
  monthly subscription. The user suggested approximately 12 panels and/or one
  or two screenplays, then approximately $4.95/month. Starting implementation
  defaults are 12 panels and two script generations; each new script version
  counts as a generation. These are provisional amounts, not a promise of
  unlimited paid generation. **Why:** the user changed the release requirements.
- Keep Noir's subscription catalog separate from other apps in the connected
  RevenueCat account. Use Google Play for Android in-app subscriptions; do not
  add Stripe or change the PC interface as part of the Android billing request.
- Do not deliver an unrestricted free Android build as a substitute for the
  requested subscription release. **Why:** the user explicitly rejected it
  because public AI generation would incur their API costs.
- Billing failures must block further generation, not silently grant free use.
  Store activation and backend publication are separate release prerequisites;
  an AAB containing purchase controls is not proof that payments are active.
- The user requires direct server-side Google Play Developer API verification,
  including payment, renewals, cancellation, expiration, refunds and restore.
  Do not substitute RevenueCat entitlement responses for that requirement.
- Do not report the subscription release complete until verification has passed.
  Clearly distinguish fixture/browser tests from live Play-store purchases.

## Generation cost protection

- Shared public generation routes enforce persistent usage reservations before
  contacting AI providers and now require a licensed Android app/device proof.
  The PC interface layout is unchanged, but anonymous web generation is blocked
  because it would bypass the Android paywall.
- Anonymous device/network trial limits and a bounded aggregate introductory
  budget prevent unmetered public requests. Failed attempts have separate
  processing ceilings, and transcription is limited server-side to five minutes.
- Paid allowances are conservative implementation defaults, not user-confirmed
  subscription terms. Do not promise unlimited AI generation at $4.95/month.

- The user assumes short texts for now; short, information-dense writing may still need many panels.
- Match the provided photographic black-and-white noir comic style, rather than a generic illustrated comic style.
- Keep speech balloons compact and out of the way of faces and valuable imagery.

## Gotchas

- Image generation uses the user's OpenAI API balance and may take several minutes.
- Keep API credentials server-side and never log keys, source text, or image payloads.
- Re-run API codegen after contract changes.
- Venice's model catalog can be read publicly, so it is not proof that a key works. Verify credentials with the authenticated access/rate-limit endpoint as well.
- Binary OpenAPI request bodies generate Blob types; the shared Zod package needs DOM type definitions for these contracts, even though its runtime also runs on Node.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
