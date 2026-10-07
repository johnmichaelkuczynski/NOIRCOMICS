---
name: Venice moderation limits
description: Non-explicit scenes can still be rejected by upstream Venice image moderation.
---

Do not promise that switching to Venice fixes every rejection involving non-explicit swimwear. Distinguish credential health, request-format errors, and upstream moderation denials.

**Why:** live integration requests verified the key and successfully generated an ordinary noir office scene, while Venice's moderated image model declined a non-sexual adult swimsuit scene. The first denial arrived as HTTP 422, with its moderation explanation inside the error body rather than an OpenAI-style error code.

**How to apply:** classify upstream errors without exposing their raw payloads, which can echo source text or images. Report moderation denials honestly. Recheck behavior when changing models; one model's rejection is not a statement about all Venice models.
