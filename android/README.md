# Noir Comic Generator — Android release

## Monetization change pending

The delivered version 1.0.0 does not contain usage limits or purchases and must
not be released as the subscription build. The requested replacement is free
to install, with an introductory allowance of approximately 12 panels and one
or two screenplay generations, followed by approximately $4.95/month.
The initial working defaults are 12 panels and two screenplay generations,
including regenerated versions. Paid monthly generation allowances remain to
be determined; do not advertise unlimited AI generation.

RevenueCat is connected for subscription management. Google Play authorization
and the Noir app's real store product configuration are still needed.
Do not change any other app's existing RevenueCat catalog.

This is a separate Android application; the approved PC interface and backend
source are not changed by packaging it.

The Android app bundles a production build of the approved PC interface, loads
it in an HTTPS-origin Android WebView, and calls the published server. OpenAI,
AssemblyAI and Venice credentials stay exclusively on the server.

- Android package: `ink.noircomics.app`
- Version: `1.0.0` / version code `1`
- Minimum Android: 10 (API 29)
- Target and compile Android: 16 (API 36)
- Recording permission: microphone only, requested when dictation is used
- Files: native Android document picker for imports; downloads saved directly
  to `Downloads/NoirComics` without broad storage permission
- Recording stops when the app leaves the foreground
- No payments, login wall, background music, tracking SDK, or native `.so` libraries

## Backend release prerequisite

The verified production origin is `https://noircomics.ink`.
At packaging time, its `/api/comics/script` endpoint returned HTTP 404.
The approved web/backend version must be republished before the Android
script, new-version and AssemblyAI features can work against production.
Publishing the approved version does not require redesigning the PC app.

## Building

Use Java 17, Gradle 8.14.x and Android SDK platform/build-tools 36.
Build the existing web frontend with `BASE_PATH=/android-app/`,
`NODE_ENV=production`, and a `PORT` value, overriding Vite's output directory
to `generated-artifacts/android/assets/web`. This is a build-only environment,
not a change to the desktop workflow or source.

Run Gradle from this directory with:

`gradle :app:bundleRelease -PappOrigin=https://noircomics.ink`

Then run `node android/tools/sign-bundle.mjs` from the workspace root. The
result is `generated-artifacts/android/noir-comic-generator-android-1.0.0.aab`.

Provide the SDK through `ANDROID_HOME`. A local `aapt2` may be selected using
`-Pandroid.aapt2FromMavenOverride=/path/to/aapt2`. This workspace provides an
FHS-compatible `/lib64/ld-linux-x86-64.so.2` alongside Nix packages: use the
compatible SDK interpreter, not an older Nix glibc interpreter mixed with host
libraries. Validate `aapt2 version` before starting Gradle.

Signing uses `.android-signing/noir-upload.p12` at the workspace root, alias
`noir-upload`. The signing tool uses `ANDROID_UPLOAD_KEY_PASSWORD` if configured
at key creation; otherwise it derives a distinct encryption password from the
existing protected `SESSION_SECRET` with domain-separated HMAC-SHA256.
Passwords are neither printed, saved in project files, nor embedded in the app.
The non-secret key configuration records which protected source was used.
Do not rotate that source until the keystore has been re-encrypted privately.
Never commit, publish, log or place the private upload key in the public
asset Library. Keep an encrypted backup privately; retain this key/package
identity for future releases.

Gradle's intermediate bundle may be unsigned. Deliver only the separate output
of the signing tool after its JAR signature verification passes.

The AAB alone does not complete Google Play's store listing, privacy policy,
data-safety disclosures, AI-generated-content policy obligations, or testing
requirements. Physical-device microphone, native downloads and Android
lifecycle behavior require device testing; browser tests do not establish them.
