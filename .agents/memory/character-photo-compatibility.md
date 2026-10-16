---
name: Character photo compatibility
description: Prevent silent loss of character likeness references across provider and Android/server version boundaries.
---

Do not send character-photo generation to a server that has not advertised support for the feature.

**Why:** The Android application embeds its frontend and can be newer than the published server. Older generated request validators strip unknown fields, so accepting an ordinary comic response is not proof that the server used the character photos.

**How to apply:** Maintain the server-capability check when changing bundled clients or generation contracts. An incompatible backend must produce a visible blocker before generation, not silently ignore the photos or charge for a comic without them.

Count the noir style image separately from the character photos when choosing an image model.

**Why:** Four character photos require five provider inputs, and edit-model input limits differ. The ordinary single-image Venice path cannot simply be assumed to accept the extra photos.

**How to apply:** Check the live model catalog's input limits and use the documented multi-image endpoint for reference-assisted comics. Preserve the ordinary no-photo generation path and disclose any model/provider-charge difference.
