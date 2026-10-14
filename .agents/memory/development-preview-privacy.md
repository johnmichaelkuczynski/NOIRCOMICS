---
name: Development preview privacy
description: Do not infer workspace preview privacy from Replit's default settings or development mode.
---

Do not assume a development URL is private just because Replit documents private development URLs as the default.

**Why:** On 2026-10-14, an anonymous external request reached this workspace's development frontend successfully. The actual setting differed from the documented default. Development mode alone identifies an environment, not a developer.

**How to apply:** Check actual anonymous access before making claims about preview privacy. Settings can change; the recorded observation is not proof of the current setting. Respect the user's current scope rather than adding an authentication system to compensate without authorization.
