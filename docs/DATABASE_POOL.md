# PostgreSQL pool (scheduler, worker, any service using `@glyphor/shared/db`)

## Where it is configured

Single shared module: **`packages/shared/src/db.ts`**.

- **`pg.Pool`** is created once per Node process with `buildPoolConfig()`.
- **`glyphor-scheduler`** and **`glyphor-worker`** do not define separate pools; both depend on `@glyphor/shared` and use this pool when they call `systemQuery`, `pool.query`, etc.

## Current settings (after Feb 2026 tuning)

| Setting | Default | Env override |
|--------|---------|----------------|
| **max** (pool size per instance) | **32** | `PG_POOL_MAX` (1–100) |
| **connectionTimeoutMillis** | **10_000** | `PG_POOL_CONNECTION_TIMEOUT_MS` (1000–120000) |
| **idleTimeoutMillis** | **30_000** | `PG_POOL_IDLE_TIMEOUT_MS` (1000–600000) |

Previously `max` was **20** and acquire timeout **5s**, which aligned with Tier2 tool health running **5 tools in parallel** (`TIER2_CONCURRENCY` in `packages/agent-runtime/src/testing/tier2ConnectivityTester.ts`). Under load, bursts could wait on the pool and surface as **“timeout exceeded when trying to connect”** (~5s+) plus tool work (~8s cap for static tools in Tier2), i.e. **~11s** total.

## Cloud SQL limit

Terraform sets instance flag **`max_connections` = 200** on `glyphor-db` (`infra/terraform/main.tf`). Leave headroom for admin sessions, other clients, and multiple Cloud Run instances (each instance has its own pool).

## Diagnostics

```bash
npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/db-pool-activity.ts
```

Interpreting results:

- Many rows in **`idle in transaction`** → missing **`COMMIT`/`ROLLBACK`** or error paths that skip cleanup. Our helpers `systemTransaction` / `tenantTransaction` use `try/finally` with `ROLLBACK` on error; ad-hoc `BEGIN` elsewhere would need audit.

## Fleet findings cleanup (resolved tools)

See **`scripts/sql/resolve-fleet-findings-tool-fixes.sql`**.
