---
name: Database test safety
description: Local environment flags do not prove DATABASE_URL points to a disposable development database.
---

Do not run database-writing fixtures or cleanup hooks against the default connection without explicitly confirming a disposable development target. Default billing test runs should use pure fixtures.

**Why:** A local test process inherited the externally supplied production connection string despite running outside production mode. Pre-existing integration tests and cleanup hooks tried to use that database, showing that NODE_ENV alone is not adequate isolation.

**How to apply:** Require explicit opt-in and a verified development target for database integration tests. Guard cleanup hooks as well as tests. Never create tables or reset a real database to make tests pass.
