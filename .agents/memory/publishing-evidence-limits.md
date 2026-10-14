---
name: Publishing evidence limits
description: Avoid overclaiming a cause when pre-build migration validation is not exposed by deployment tooling.
---

Do not treat an older successful deployment as the current republish status, or a missing-production-database lookup error as proof of why validation is stuck.

**Why:** During a PC republish stuck at migration validation, available build history exposed only an older success, production lookup/diff failed, and development statistics showed no validation transaction or lock. The separate validator's logs and state were not accessible.

**How to apply:** Compare build timestamps to the reported attempt. Distinguish development database observations from inaccessible production or temporary validation databases. Report the evidence and its limits rather than inventing a SQL fix or promising that database setup alone resolves the hang.
