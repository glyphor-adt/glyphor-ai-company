# Database Migrations

This directory contains PostgreSQL migrations for the Glyphor database,
hosted on **GCP Cloud SQL** (PostgreSQL 15, instance `glyphor-db` in `us-central1`).

## Multi-Tenancy Security Model

The database implements row-level security (RLS) for tenant isolation. See migration `20260302100003_row_level_security.sql` for details.

### Database Users and Roles

1. **`glyphor_system`** (NOLOGIN role)
   - Group role with RLS bypass policies on all tenant-scoped tables
   - Cannot log in directly; must be assumed via `SET ROLE`

2. **`glyphor_system_user`** (LOGIN user)
   - Dedicated user for backend services (scheduler, worker) that need system-wide access
   - Has `glyphor_system` role granted, allowing RLS bypass via `SET ROLE glyphor_system`
   - **Use for**: Services that call `systemQuery()` in `@glyphor/shared/db`
   - **Environment**: Set `DB_USER=glyphor_system_user` for scheduler and worker services

3. **`glyphor_app`** (LOGIN user)
   - General application user for tenant-scoped operations
   - Does NOT have `glyphor_system` granted - cannot bypass RLS
   - **Use for**: Dashboard, API services, any tenant-scoped application
   - **Environment**: Set `DB_USER=glyphor_app` for dashboard and tenant services

### Setup Instructions

After running the RLS migration, you must set a password for `glyphor_system_user`:

```sql
ALTER ROLE glyphor_system_user WITH PASSWORD 'REPLACE_WITH_SECURE_PASSWORD';
```

Generate a strong password using:
```bash
openssl rand -base64 32
```

Store this password in GCP Secret Manager:

```bash
# Generate and store the password (replace the password with actual generated value)
openssl rand -base64 32 | gcloud secrets create db-system-password \
  --data-file=- \
  --project=ai-glyphor-company

# Grant access to the scheduler service account
gcloud secrets add-iam-policy-binding db-system-password \
  --member="serviceAccount:glyphor-scheduler@ai-glyphor-company.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=ai-glyphor-company
```

### Deployment Configuration

#### Scheduler Service (needs system access)

```yaml
env:
  - DB_HOST: /cloudsql/ai-glyphor-company:us-central1:glyphor-db
  - DB_NAME: glyphor
  - DB_USER: glyphor_system_user  # ← Uses system user
secrets:
  - DB_PASSWORD: db-system-password:latest
```

#### Dashboard Service (tenant-scoped)

```yaml
env:
  - DB_HOST: /cloudsql/ai-glyphor-company:us-central1:glyphor-db
  - DB_NAME: glyphor
  - DB_USER: glyphor_app  # ← Uses regular app user
secrets:
  - DB_PASSWORD: db-password:latest
```

### Why This Matters

This separation ensures:

- **Tenant Isolation**: Regular application code cannot accidentally or maliciously access other tenants' data
- **Principle of Least Privilege**: Only services that explicitly need cross-tenant access have it
- **Defense in Depth**: Even if there's SQL injection in dashboard code, it cannot bypass RLS
- **Audit Trail**: System-wide operations are clearly separated from tenant operations

### Migration Files

Key migrations in order:

1. `20260302100001_tenants.sql` - Core tenant tables
2. `20260302100002_tenant_isolation.sql` - Add tenant_id columns to existing tables
3. `20260302100003_row_level_security.sql` - Enable RLS and create security roles
4. `20260302100004_seed_glyphor_tenant.sql` - Seed default tenant

## Running Migrations

Migrations are applied manually via `psql` against Cloud SQL:

```bash
# Connect via Cloud SQL Auth Proxy or direct IP
psql "host=/cloudsql/ai-glyphor-company:us-central1:glyphor-db dbname=glyphor user=glyphor_system_user"

# Apply a specific migration
\i db/migrations/20260302100003_row_level_security.sql
```

## Migration Ledger And Drift Checks

The repo now includes a lightweight migration ledger to reduce future schema drift.

Ledger table:
- `schema_migrations`
- stores migration file name, checksum, applied timestamp, DB user, and source

Recommended workflow:

```bash
# One-time after reconciling a live database with the repo
npm run db:reconcile-ledger

# Apply a future migration and record it in the ledger
npm run db:apply-migration -- 20260308001000_schema_migration_ledger.sql

# Check for drift between db/migrations and the live ledger
npm run db:drift-check
```

Connection settings for the scripts use standard env vars:
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- or `DATABASE_URL`

For local Cloud SQL Proxy usage, a typical pattern is:

```bash
DB_HOST=localhost
DB_PORT=15432
DB_NAME=glyphor
DB_USER=glyphor_app
DB_PASSWORD=<from GCP Secret Manager>
```
