---
name: Google Play setup
description: Distinguish native subscription prerequisites from the optional Google Play OAuth connector.
---

Do not make the Replit Google Play OAuth connector a prerequisite for building
an Android App Bundle or implementing native purchases. RevenueCat's documented
Google Play connection uses a Play-authorized service account instead.

**Why:** On 2026-10-14 the proposed connector opened Google's generic malformed
authorization-request error. Its live setup instructions additionally documented
an incorrect API base host (`play.googleapis.com` rather than
`androidpublisher.googleapis.com`). The API-host defect does not establish the
exact cause of the separate OAuth error; do not conflate them or repeatedly
send the user through that failed setup.

**How to apply:** Recheck live connector details before relying on it; its
configuration may be repaired later. For native billing, configure the actual
Play subscription and authorize RevenueCat through its service-credential
workflow. A signed bundle can be built beforehand, but successful compilation,
a RevenueCat catalog, or a public SDK key does not prove payments are live.

Reference: https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials
