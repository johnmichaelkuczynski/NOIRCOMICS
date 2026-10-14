# Noir Comic Generator — Android release

## Version 1.3.0 — internal-testing build; activation still pending

Version 1.0.0 was unrestricted and must not be used for the commercial release.
Version 1.3.0 retains direct Google Play Developer API subscription/order verification,
acknowledgement, authenticated real-time notifications and Play Integrity-bound
device sessions, receipt restoration and generation requests.
The Android trial is now two COMPLETE comic generations, regardless of the
selected panel count. Failed/incomplete comics do not consume that allowance.
New trial/job records use the existing billing_usage table; no migrations
are added and existing usage or purchase records are not rewritten.
Separate existing assist limits remain two script generations (including
new versions) and 12 five-minute dictations. The conservative paid defaults
are 24 panels, 20 scripts and 30 dictations per verified billing period;
these paid amounts are implementation defaults, not confirmed user requirements.
Comic trial failures do not count; Play Integrity challenges remain rate-limited.
No unlimited-generation
plan or billing-error fallback is enabled.

Noir has a separate RevenueCat project, Android app and monthly offering.
RevenueCat supplies the native Google Play purchase UI/catalog, but backend paid
access is determined directly by Google's subscriptionsv2 and orders APIs.
Actual payments are NOT verified live.
Create Google Play subscription `noir_monthly_v1` with a one-month
auto-renewing base plan `monthly`, set the intended USD $4.95 price, and
configure Google Play service-account credentials in the backend's protected
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret (and in RevenueCat for its client-side
purchase bookkeeping).
This is not the optional Replit Google Play OAuth connector; that connector
failed authorization and its current setup notes document an incorrect API host.
Store credentials belong in RevenueCat's secure credential settings, not chat
or this repository. Do not change other apps' RevenueCat catalogs.

This is a separate Android application; the approved PC interface is unchanged.
Android requests carry an authenticated session and fresh, one-use,
body/path/device-bound Play Integrity proof. Ordinary PC requests remain
independent of Android subscription verification and are not subjected to
the Android comic trial. Do not remove that PC branch to address Android abuse.
Android script/dictation assist limits and paid usage limits remain separate.

The Android app bundles a production build of the approved PC interface, loads
it in an HTTPS-origin Android WebView, and calls the published server. OpenAI,
AssemblyAI and Venice credentials stay exclusively on the server.

- Android package: `ink.noircomics.app`
- Version: `1.3.0` / version code `4`
- Minimum Android: 10 (API 29)
- Target and compile Android: 16 (API 36)
- Recording permission: microphone only, requested when dictation is used
- Files: native Android document picker for imports; downloads saved directly
  to `Downloads/NoirComics` without broad storage permission
- Recording stops when the app leaves the foreground
- Native Google Play subscriptions through RevenueCat; no login entry wall,
  background music, or native `.so` libraries

## Backend release prerequisite

The verified production origin is `https://noircomics.ink`.
The new billing-enabled backend and its database schema must be published.
Android requires `/api/billing/session` and `/api/billing/usage` protocol version
4 before it sends generation requests. An older/unavailable backend blocks
generation instead of falling back to unmetered endpoints.
Publishing this backend is separate from uploading the AAB to Google Play;
the user handles both publishing decisions. No Google Play upload is automated.
Do not publish the PC app as part of preparing this Android bundle. Activation
of Android protocol 4 requires a separate, explicitly approved backend release.
Observed production /api/billing/config still returns protocol 3, with no
Cloud project number and no configured app-signing certificate.

## Building

Use Java 17, Gradle 8.14.x and Android SDK platform/build-tools 36.
Build the existing web frontend with `BASE_PATH=/android-app/`,
`NODE_ENV=production`, and a `PORT` value, overriding Vite's output directory
to `generated-artifacts/android/assets/web`. This is a build-only environment,
not a change to the desktop workflow or source.

Run Gradle from this directory with:

`gradle :app:bundleRelease -PappOrigin=https://noircomics.ink`

Then run `node android/tools/sign-bundle.mjs` from the workspace root. The
result is `generated-artifacts/android/noir-comic-generator-android-1.3.0.aab`.

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

## Required Google Play / Google Cloud configuration

1. Upload this signed bundle yourself to an internal testing track. Do not
   release it publicly until the following items and real-device tests pass.
2. Create subscription `noir_monthly_v1`, base plan `monthly`, period `P1M`,
   auto-renewing, US price USD $4.95. Activate it. Do not add a Google store
   free-trial offer: the free generation allowance is managed by this backend.
3. Enable Google Play Android Developer API and Play Integrity API in the
   linked Google Cloud project. Authorize a service account for the Noir app
   with order/financial read and subscription/order management permissions.
   Put its JSON key only in secure Secrets, never chat or uploaded assets.
4. Set backend environment variables:
   GOOGLE_PLAY_CLOUD_PROJECT_NUMBER (the numeric linked Cloud project number)
   and GOOGLE_PLAY_APP_SIGNING_SHA256 (Play Console's APP-SIGNING certificate
   SHA-256, not blindly the upload-key fingerprint; comma-separated if rotating).
5. Configure Play Integrity for this package/Cloud project. This release
requires PLAY_RECOGNIZED, the allowed certificate, versionCode >= 4,
   LICENSED and MEETS_DEVICE_INTEGRITY. Sideloading is not a valid live test.
6. Configure Real-time Developer Notifications through Google Pub/Sub with an
   authenticated push to:
   https://noircomics.ink/api/billing/google-play/notifications
   Set GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL to that push identity and use this
   same endpoint as the OIDC audience. Grant Google's Play notification
   publisher access to the topic.
7. Publish the new backend and database schema to the verified production
   origin https://noircomics.ink. Configure the credentials in production too.
8. Add Google Play license testers. For the private test run only, explicitly
   enable GOOGLE_PLAY_ALLOW_TEST_PURCHASES=true; this defaults to false.
   Test actual purchase, pending/cancelled purchase, repeated restore, reinstall,
   another device, accelerated renewal, cancellation, expiration and refund.
   Disable test-purchase acceptance before the public release.

## Security and lifecycle behavior

- Trial identity comes from app-scoped ANDROID_ID, hashed by native code, bound
  to a server nonce through Google Play Integrity and persisted in PostgreSQL.
  Normal reinstall with the same Play app-signing key does not change this
  identifier. Physical-device reinstall has not yet been tested.
- Restore queries Google Billing for OWNED purchases in native code; JavaScript
  cannot ask the native interface to attest an arbitrary stolen receipt token.
- The server verifies product, base plan, subscription state, expiry, matching
  successful order ID, matching token, PROCESSED order status, positive payment,
  refund state and acknowledgement. Free store trials and pending payments do
  not unlock paid access. Test transactions require an explicit test flag.
- Cancellation preserves already-paid access until expiry. Paused/on-hold/
  expired/refunded purchases do not grant paid access. Grace uses the existing
  paid order, not a new allowance.
- Each generation refreshes the Google entitlement. Notifications trigger the
  same verification and cannot grant an entitlement by assertion.
- Devices restoring the same subscription share one paid allowance keyed to
  the canonical receipt and successful paid order; changing expiry alone
  cannot reset credits.
- Purchase tokens are encrypted using AES-256-GCM with a domain-separated key
  derived from SESSION_SECRET. Re-encrypt these records before rotating that
  secret, in addition to the upload-keystore precautions above.

Compilation, lint, signatures, bundle validation, fixture-based billing tests
and browser tests are distinct from actual Google Play payment verification.
This build must not be described as payment-ready without the live checks.
