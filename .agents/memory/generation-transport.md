---
name: Comic generation transport
description: Long Venice jobs must not depend on a single open gateway connection; distinguish temporary delivery from durable storage.
---

Use short acceptance and progress requests for web comic generation, not a single connection held until all panels finish.

**Why:** A user's photo-assisted request reached the server, but the gateway disconnected it after approximately 120 seconds, before the planning operation ended. Better error wording did not solve that transport limitation.

**How to apply:** Preserve one request identity through acceptance retries, and retry progress reads rather than starting generation again. Keep actual provider failures visible. Verify acceptance, pending, completed, failed, and transient-gateway states as one coherent flow.

Keep the included style references available with the loaded app instead of downloading the original large PNG when Generate is pressed.

**Why:** After the gateway repair, the user's PC browser still failed at the separate style-image fetch before any generation request could be sent, despite healthy provider connectivity. Bundling the two already-prepared JPEG references trades some initial bundle size for removing that failure point.

**How to apply:** Preserve both the ordinary full reference and the people-free photo-mode reference. Test generation with the old PNG URL unavailable, using real provider responses rather than treating simulated jobs as proof that the PC app works.

The background result buffer is temporary delivery for the current single-process app, not persistent comic storage or deployment-safe distributed job processing.

**Why:** Persistence was outside the requested gateway fix. In-memory delivery cannot survive process restarts or provide shared state across independently routed server instances.

**How to apply:** Do not claim restart recovery or multi-instance support. Before scaling to multiple workers, implement durable shared job coordination and private file storage; do not silently put image bytes into PostgreSQL.
