---
name: Publishing evidence limits
description: Avoid overclaiming a cause when pre-build migration validation is not exposed by deployment tooling.
---

Do not treat an older successful deployment as the current republish status, or a missing-production-database lookup error as proof of why validation is stuck.

**Why:** During a PC republish stuck at migration validation, available build history exposed only an older success, production lookup/diff failed, and development statistics showed no validation transaction or lock. The separate validator's logs and state were not accessible.

**How to apply:** Compare build timestamps to the reported attempt. Distinguish development database observations from inaccessible production or temporary validation databases. Report the evidence and its limits rather than inventing a SQL fix or promising that database setup alone resolves the hang.

The live Android backend uses the externally supplied Neon database, not a Replit-managed production database. Publishing does not create its missing schema.

**Why:** Managed production SQL reported no database while the published API was running against the external connection. An additive repair through that external connection immediately changed the live challenge response from 503 to 200, without republishing.

**How to apply:** Diagnose the app's actual external database before interpreting managed-database lookup failures. Confirm the target and obtain authorization for schema changes; use additive changes matching the existing schema, never test-fixture cleanup or destructive schema synchronization. Publishing server code remains a separate step.
