---
name: Character photo compatibility
description: Prevent silent loss of character likeness references across provider and Android/server version boundaries.
---

Use Venice for the photo-related function. Do not send character photos to OpenAI.

**Why:** The user explicitly directed: “YOU NEED TO USE VENICE FOR THE PHOTO-RELATED FUNCTION.”

**How to apply:** Photo interpretation and photo-assisted image generation must remain on Venice. Preserve ordinary no-photo provider options. Do not revert this choice while optimizing the photo pipeline.

Do not send character-photo generation to a server that has not advertised support for the feature.

**Why:** The Android application embeds its frontend and can be newer than the published server. Older generated request validators strip unknown fields, so accepting an ordinary comic response is not proof that the server used the character photos.

**How to apply:** Maintain the server-capability check when changing bundled clients or generation contracts. An incompatible backend must produce a visible blocker before generation, not silently ignore the photos or charge for a comic without them.

Count the noir style image separately from the character photos when choosing an image model.

**Why:** Four character photos require five provider inputs, and edit-model input limits differ. The ordinary single-image Venice path cannot simply be assumed to accept the extra photos.

**How to apply:** Check the live model catalog's input limits and use the documented multi-image endpoint for reference-assisted comics. Preserve the ordinary no-photo generation path and disclose any model/provider-charge difference.

Photo identity must take precedence over invented noir appearances, and uploaded casting must be applied to unnamed essay presenters.

**Why:** A philosophical essay may never mention the supplied character's name. Merely attaching a name and photo can leave that person uncast while the writer invents anonymous noir actors. A people-containing style sample can also compete with the intended face.

**How to apply:** Let the Venice script planner inspect the actual labeled photos; explicitly cast unnamed presenters; put identity photos ahead of the style sample with matching image numbers. Preserve the argument and plot rather than inventing events to use a reference.

Use a people-free portion of the noir reference for photo-assisted comics, not the original page containing actors.

**Why:** A real Venice test still resembled the style sample's actor even with identity photos first and explicit instructions not to copy the sample's faces. Correct routing and stronger prompts alone did not remove the competing identity.

**How to apply:** Retain lighting and monochrome texture from the fixed reference, but exclude people from photo-mode style guidance. When replacing the style asset, recheck that its photo-mode crop contains neither faces nor text. Keep the complete original reference for ordinary no-photo comics.

Do not treat a successful HTTP response or a test using faces already present in the noir style sample as proof of likeness fidelity.

**Why:** The provider accepted the previous requests, but the user showed that the resulting character did not resemble the independent uploaded portrait.

**How to apply:** Inspect the exact generated panels against an independent reference face. If only a small screenshot thumbnail is available, disclose that limitation and do not claim the full-resolution original has been verified.

Do not automatically resubmit comic generation after a browser transport failure.

**Why:** A lost connection does not establish whether the server accepted the request or is still generating; blindly retrying can duplicate paid provider work.

**How to apply:** Distinguish local style preparation from generation transport errors. Preserve the user's current inputs and report uncertainty rather than claiming a provider rejection or promising that retrying is free.
