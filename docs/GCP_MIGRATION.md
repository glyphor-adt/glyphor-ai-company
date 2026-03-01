# Glyphor Platform: Supabase → All-In GCP Migration Spec

## Executive Summary

Migrate all Supabase dependencies to native GCP services. After this migration, the entire Glyphor platform runs on a single vendor (Google Cloud) with zero third-party database or auth dependencies.

**Current State:**
- Database: Supabase (managed Postgres)
- Auth: Supabase Auth
- API: PostgREST (auto-generated REST via Supabase)
- Realtime: Supabase Realtime (WebSocket subscriptions)
- Storage: Supabase Storage
- Compute: GCP Cloud Run (already GCP)
- Queue: GCP Pub/Sub (already GCP)
- Secrets: GCP Secret Manager (already GCP)
- Cache: Redis (already deployed)

**Target State:**
- Database: Cloud SQL for PostgreSQL 15
- Auth: Firebase Auth (GCP-native)
- API: Custom Express routes in Cloud Run scheduler (replace PostgREST)
- Realtime: Firebase Realtime Database or Cloud Pub/Sub (if needed later)
- Storage: Google Cloud Storage (GCS)
- Compute: GCP Cloud Run (unchanged)
- Queue: GCP Cloud Tasks (upgrade from Pub/Sub for job queue)
- Secrets: GCP Secret Manager (unchanged)
- Cache: Redis (unchanged)

---

## GCP Project Configuration

**Project:** `ai-glyphor-company` (existing)
**Region:** `us-central1` (keep consistent with existing Cloud Run)

---

## Part 1: Cloud SQL Instance Setup

### 1.1 Create the Cloud SQL Instance

```bash
# Create Cloud SQL PostgreSQL 15 instance
gcloud sql instances create glyphor-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-8192 \
  --region=us-central1 \
  --storage-size=20GB \
  --storage-auto-increase \
  --availability-type=regional \
  --backup-start-time=03:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=14 \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=05 \
  --database-flags=max_connections=200,log_min_duration_statement=1000,shared_preload_libraries=pg_stat_statements \
  --root-password=<GENERATE_SECURE_PASSWORD>

# Create the application database
gcloud sql databases create glyphor \
  --instance=glyphor-db

# Create application user (not root)
gcloud sql users create glyphor_app \
  --instance=glyphor-db \
  --password=<GENERATE_SECURE_PASSWORD>

# Create read-only user for dashboard queries
gcloud sql users create glyphor_readonly \
  --instance=glyphor-db \
  --password=<GENERATE_SECURE_PASSWORD>
```

### 1.2 Instance Tier Scaling Guide

| Customers | Tier | vCPUs | RAM | Storage | Monthly Cost |
|-----------|------|-------|-----|---------|-------------|
| 1-100 | db-custom-2-8192 | 2 | 8GB | 20GB | ~$100 |
| 100-500 | db-custom-4-16384 | 4 | 16GB | 50GB | ~$250 |
| 500-2000 | db-custom-8-32768 | 8 | 32GB | 100GB | ~$500 |
| 2000-5000 | db-custom-16-65536 | 16 | 64GB | 200GB | ~$1000 |

Start with the smallest tier. Scale up via:
```bash
gcloud sql instances patch glyphor-db --tier=db-custom-4-16384
```
This causes a few minutes of downtime. For zero-downtime scaling, enable HA (already set with `--availability-type=regional`).

### 1.3 Connection Configuration

Cloud Run connects to Cloud SQL via the Cloud SQL Auth Proxy (built into Cloud Run):

```bash
# Grant Cloud Run service account access to Cloud SQL
gcloud projects add-iam-policy-binding ai-glyphor-company \
  --member="serviceAccount:<CLOUD_RUN_SERVICE_ACCOUNT>" \
  --role="roles/cloudsql.client"
```

**Connection string format for Cloud Run:**
```
postgresql://glyphor_app:<PASSWORD>@localhost:5432/glyphor?host=/cloudsql/ai-glyphor-company:us-central1:glyphor-db
```

Cloud Run's built-in Cloud SQL proxy handles the connection — no separate proxy container needed.

### 1.4 Cloud Run Service Update

Add the Cloud SQL connection to both scheduler and worker services:

```bash
# Update scheduler
gcloud run services update glyphor-scheduler \
  --add-cloudsql-instances=ai-glyphor-company:us-central1:glyphor-db \
  --set-env-vars="DB_HOST=/cloudsql/ai-glyphor-company:us-central1:glyphor-db,DB_NAME=glyphor,DB_USER=glyphor_app"

# Update worker (new service)
gcloud run services update glyphor-worker \
  --add-cloudsql-instances=ai-glyphor-company:us-central1:glyphor-db \
  --set-env-vars="DB_HOST=/cloudsql/ai-glyphor-company:us-central1:glyphor-db,DB_NAME=glyphor,DB_USER=glyphor_app"
```

Store the database password in Secret Manager:
```bash
echo -n "<PASSWORD>" | gcloud secrets create db-password --data-file=-

# Reference in Cloud Run
gcloud run services update glyphor-scheduler \
  --set-secrets="DB_PASSWORD=db-password:latest"
```

---

## Part 2: Database Migration

### 2.1 Export from Supabase

```bash
# Option A: pg_dump from Supabase (recommended)
# Get connection string from Supabase dashboard → Settings → Database → Connection string
pg_dump "postgresql://postgres.<project-ref>:<password>@aws-0-us-central1.pooler.supabase.com:5432/postgres" \
  --no-owner \
  --no-privileges \
  --schema=public \
  --format=custom \
  --file=glyphor_backup.dump

# Option B: If pg_dump doesn't work, export via Supabase CLI
supabase db dump --db-url "postgresql://..." > glyphor_schema.sql
supabase db dump --db-url "postgresql://..." --data-only > glyphor_data.sql
```

### 2.2 Import to Cloud SQL

```bash
# Upload dump to Cloud Storage first (Cloud SQL imports from GCS)
gsutil cp glyphor_backup.dump gs://glyphor-backups/migration/glyphor_backup.dump

# Import via gcloud
gcloud sql import sql glyphor-db gs://glyphor-backups/migration/glyphor_backup.dump \
  --database=glyphor

# OR if using SQL files:
gcloud sql import sql glyphor-db gs://glyphor-backups/migration/glyphor_schema.sql \
  --database=glyphor
gcloud sql import sql glyphor-db gs://glyphor-backups/migration/glyphor_data.sql \
  --database=glyphor
```

### 2.3 Verify Migration

Connect to Cloud SQL and verify:

```bash
# Connect via Cloud SQL Auth Proxy for local access
gcloud sql connect glyphor-db --user=glyphor_app --database=glyphor
```

```sql
-- Verify table count (should be 86+ tables)
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

-- Verify critical tables have data
SELECT 'company_agents' as tbl, COUNT(*) as rows FROM company_agents
UNION ALL SELECT 'agent_runs', COUNT(*) FROM agent_runs
UNION ALL SELECT 'kg_nodes', COUNT(*) FROM kg_nodes
UNION ALL SELECT 'kg_edges', COUNT(*) FROM kg_edges
UNION ALL SELECT 'agent_briefs', COUNT(*) FROM agent_briefs
UNION ALL SELECT 'shared_episodes', COUNT(*) FROM shared_episodes
UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log;

-- Verify all 44 agents exist
SELECT COUNT(*) FROM company_agents WHERE status = 'active';
```

### 2.4 Run New Multi-Tenancy Migrations

After base data is imported, run these new migrations against Cloud SQL:

**Migration 001: Core tenant tables**
```sql
-- File: migrations/20260302_001_tenants.sql

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  website TEXT,
  industry TEXT,
  competitors JSONB DEFAULT '[]',
  brand_voice TEXT,
  product TEXT NOT NULL CHECK (product IN ('marketing', 'finance', 'research', 'operations', 'full')),
  status TEXT DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused', 'churned')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tenant_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('slack', 'teams', 'email', 'webhook')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  workspace_external_id TEXT,
  channel_mapping JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform)
);

CREATE TABLE tenant_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT,
  model_tier TEXT DEFAULT 'gpt-4o-mini',
  brief_template TEXT NOT NULL,
  brief_compiled TEXT,
  delivery_channel TEXT,
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, agent_role)
);

-- Indexes
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_product ON tenants(product);
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenant_agents_tenant ON tenant_agents(tenant_id);
CREATE INDEX idx_tenant_agents_active ON tenant_agents(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_tenant_agents_schedule ON tenant_agents(last_run_at) WHERE is_active = true;
CREATE INDEX idx_tenant_workspaces_tenant ON tenant_workspaces(tenant_id);
```

**Migration 002: Add tenant_id to existing tables**
```sql
-- File: migrations/20260302_002_tenant_isolation.sql

-- Add tenant_id to all customer-scoped tables
ALTER TABLE agent_runs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE kg_nodes ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE kg_edges ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE shared_episodes ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE activity_log ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE founder_directives ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE work_assignments ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agent_messages ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agent_meetings ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agent_briefs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agent_trust_scores ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE drift_alerts ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE platform_audit_log ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agent_constitutions ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Indexes for tenant-scoped queries
CREATE INDEX idx_agent_runs_tenant ON agent_runs(tenant_id);
CREATE INDEX idx_agent_runs_tenant_time ON agent_runs(tenant_id, started_at DESC);
CREATE INDEX idx_kg_nodes_tenant ON kg_nodes(tenant_id);
CREATE INDEX idx_kg_edges_tenant ON kg_edges(tenant_id);
CREATE INDEX idx_episodes_tenant ON shared_episodes(tenant_id);
CREATE INDEX idx_activity_tenant ON activity_log(tenant_id);
CREATE INDEX idx_directives_tenant ON founder_directives(tenant_id);
CREATE INDEX idx_assignments_tenant ON work_assignments(tenant_id);
CREATE INDEX idx_messages_tenant ON agent_messages(tenant_id);
CREATE INDEX idx_meetings_tenant ON agent_meetings(tenant_id);
CREATE INDEX idx_briefs_tenant ON agent_briefs(tenant_id);
CREATE INDEX idx_trust_scores_tenant ON agent_trust_scores(tenant_id);
CREATE INDEX idx_drift_alerts_tenant ON drift_alerts(tenant_id);
CREATE INDEX idx_audit_log_tenant ON platform_audit_log(tenant_id);
CREATE INDEX idx_constitutions_tenant ON agent_constitutions(tenant_id);
```

**Migration 003: Row Level Security**
```sql
-- File: migrations/20260302_003_row_level_security.sql

-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_directives ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_trust_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_constitutions ENABLE ROW LEVEL SECURITY;

-- RLS policies: app user can access rows matching current tenant context
-- The app sets tenant context via: SET app.current_tenant = '<tenant-uuid>';

CREATE POLICY tenant_access ON tenants
  FOR ALL USING (id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_workspaces_access ON tenant_workspaces
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_agents_access ON tenant_agents
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY agent_runs_access ON agent_runs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY kg_nodes_access ON kg_nodes
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY kg_edges_access ON kg_edges
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY episodes_access ON shared_episodes
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY activity_access ON activity_log
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY directives_access ON founder_directives
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY assignments_access ON work_assignments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY messages_access ON agent_messages
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY meetings_access ON agent_meetings
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY briefs_access ON agent_briefs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY trust_scores_access ON agent_trust_scores
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY drift_alerts_access ON drift_alerts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY audit_log_access ON platform_audit_log
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY constitutions_access ON agent_constitutions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- CRITICAL: The scheduler/worker service account needs to bypass RLS
-- for cross-tenant operations (scheduling, billing, monitoring)
-- Create a superuser role for system operations
CREATE ROLE glyphor_system NOLOGIN;
GRANT ALL ON ALL TABLES IN SCHEMA public TO glyphor_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO glyphor_system;

-- Grant bypass to the app user for system operations
-- In code, use SET ROLE glyphor_system; for scheduler operations
-- and SET app.current_tenant for tenant-scoped operations
GRANT glyphor_system TO glyphor_app;
```

**Migration 004: Seed Glyphor as Tenant 0**
```sql
-- File: migrations/20260302_004_seed_glyphor_tenant.sql

-- Create Glyphor as the first tenant
INSERT INTO tenants (id, name, slug, website, industry, product, status)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Glyphor Labs',
  'glyphor',
  'https://glyphor.ai',
  'AI Technology',
  'full',
  'active'
);

-- Backfill all existing data with Glyphor tenant ID
UPDATE agent_runs SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE kg_nodes SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE kg_edges SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE shared_episodes SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE activity_log SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE founder_directives SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE work_assignments SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_messages SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_meetings SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_briefs SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_trust_scores SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE drift_alerts SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE platform_audit_log SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_constitutions SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;

-- Now make tenant_id NOT NULL on critical tables
ALTER TABLE agent_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE kg_nodes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE kg_edges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_briefs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE founder_directives ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE work_assignments ALTER COLUMN tenant_id SET NOT NULL;
```

---

## Part 3: Replace PostgREST with Direct API

### 3.1 Identify All PostgREST Usage

Search the codebase for all Supabase client calls. These patterns need replacement:

```typescript
// FIND THESE PATTERNS:
supabase.from('table_name').select(...)
supabase.from('table_name').insert(...)
supabase.from('table_name').update(...)
supabase.from('table_name').delete(...)
supabase.from('table_name').upsert(...)
supabase.rpc(...)

// Also search for:
import { createClient } from '@supabase/supabase-js'
process.env.SUPABASE_URL
process.env.SUPABASE_ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY
```

### 3.2 Create Database Abstraction Layer

Replace all Supabase client usage with a direct Postgres pool:

```typescript
// File: packages/shared/src/db.ts

import { Pool, PoolClient } from 'pg';

// Connection pool - connects via Cloud SQL Auth Proxy
const pool = new Pool({
  host: process.env.DB_HOST,       // /cloudsql/ai-glyphor-company:us-central1:glyphor-db
  database: process.env.DB_NAME,   // glyphor
  user: process.env.DB_USER,       // glyphor_app
  password: process.env.DB_PASSWORD,
  max: 20,                          // Max connections per Cloud Run instance
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Execute a query with tenant context (RLS enforced)
export async function tenantQuery<T = any>(
  tenantId: string,
  sql: string,
  params?: any[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_tenant = '${tenantId}'`);
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

// Execute a system query (bypasses RLS - for scheduler, billing, monitoring)
export async function systemQuery<T = any>(
  sql: string,
  params?: any[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('SET ROLE glyphor_system');
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

// Transaction with tenant context
export async function tenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET app.current_tenant = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// System transaction (bypasses RLS)
export async function systemTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET ROLE glyphor_system');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

// Helper: Insert and return the created row
export async function insertReturning<T = any>(
  tenantId: string,
  table: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  const sql = `INSERT INTO ${table} (tenant_id, ${columns}) VALUES ('${tenantId}', ${placeholders}) RETURNING *`;
  const rows = await tenantQuery<T>(tenantId, sql, values);
  return rows[0];
}

// Helper: Update by ID
export async function updateById<T = any>(
  tenantId: string,
  table: string,
  id: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

  const sql = `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`;
  const rows = await tenantQuery<T>(tenantId, sql, [...values, id]);
  return rows[0];
}

// Health check
export async function checkDbHealth(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1');
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  await pool.end();
}
```

### 3.3 Translation Guide: Supabase → Direct SQL

**Pattern: Simple SELECT**
```typescript
// BEFORE (Supabase)
const { data } = await supabase
  .from('company_agents')
  .select('*')
  .eq('status', 'active');

// AFTER (Direct SQL)
const data = await tenantQuery(tenantId,
  `SELECT * FROM company_agents WHERE status = $1`,
  ['active']
);
```

**Pattern: SELECT with joins**
```typescript
// BEFORE
const { data } = await supabase
  .from('agent_runs')
  .select('*, company_agents(display_name)')
  .eq('status', 'completed')
  .order('started_at', { ascending: false })
  .limit(10);

// AFTER
const data = await tenantQuery(tenantId,
  `SELECT ar.*, ca.display_name
   FROM agent_runs ar
   JOIN company_agents ca ON ca.agent_id = ar.agent_id
   WHERE ar.status = $1
   ORDER BY ar.started_at DESC
   LIMIT 10`,
  ['completed']
);
```

**Pattern: INSERT**
```typescript
// BEFORE
const { data } = await supabase
  .from('agent_runs')
  .insert({ agent_id: 'cmo', task: 'heartbeat', status: 'running' })
  .select()
  .single();

// AFTER
const data = await insertReturning(tenantId, 'agent_runs', {
  agent_id: 'cmo',
  task: 'heartbeat',
  status: 'running'
});
```

**Pattern: UPDATE**
```typescript
// BEFORE
const { data } = await supabase
  .from('agent_runs')
  .update({ status: 'completed', duration_ms: 5000 })
  .eq('id', runId)
  .select()
  .single();

// AFTER
const data = await updateById(tenantId, 'agent_runs', runId, {
  status: 'completed',
  duration_ms: 5000
});
```

**Pattern: UPSERT**
```typescript
// BEFORE
await supabase
  .from('agent_trust_scores')
  .upsert({ agent_role: 'cmo', trust_score: 0.95 }, { onConflict: 'agent_role' });

// AFTER
await tenantQuery(tenantId,
  `INSERT INTO agent_trust_scores (tenant_id, agent_role, trust_score)
   VALUES ($1, $2, $3)
   ON CONFLICT (tenant_id, agent_role) DO UPDATE
   SET trust_score = EXCLUDED.trust_score, updated_at = NOW()`,
  [tenantId, 'cmo', 0.95]
);
```

**Pattern: RPC (stored procedure)**
```typescript
// BEFORE
const { data } = await supabase.rpc('my_function', { param1: 'value' });

// AFTER
const data = await tenantQuery(tenantId,
  `SELECT * FROM my_function($1)`,
  ['value']
);
```

---

## Part 4: Replace Supabase Auth with Firebase Auth

### 4.1 Setup Firebase Auth

```bash
# Enable Firebase in your GCP project
firebase projects:addfirebase ai-glyphor-company

# Enable Authentication
firebase auth:import  # if migrating existing users

# Or configure via Firebase Console:
# https://console.firebase.google.com/project/ai-glyphor-company/authentication
```

Enable these sign-in providers in Firebase Console:
- Email/Password (for direct signups)
- Google (for OAuth)
- Custom tokens (for Slack OAuth → Firebase session)

### 4.2 Firebase Auth Integration

```typescript
// File: packages/shared/src/auth.ts

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin (server-side)
const app = initializeApp({
  credential: cert({
    projectId: 'ai-glyphor-company',
    // Load from Secret Manager
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  }),
});

const auth = getAuth(app);

// Verify a customer's auth token (called on every API request)
export async function verifyToken(idToken: string): Promise<{
  uid: string;
  email: string;
  tenantId: string;
}> {
  const decoded = await auth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    tenantId: decoded.tenantId || '', // Custom claim set during signup
  };
}

// Create a new customer user and link to tenant
export async function createCustomerUser(
  email: string,
  password: string,
  tenantId: string
): Promise<string> {
  const user = await auth.createUser({
    email,
    password,
    emailVerified: false,
  });

  // Set custom claims to link user to tenant
  await auth.setCustomUserClaims(user.uid, {
    tenantId,
    role: 'owner',
  });

  return user.uid;
}

// Create a session after Slack OAuth
export async function createSlackSession(
  slackUserId: string,
  email: string,
  tenantId: string
): Promise<string> {
  // Create or get Firebase user for this Slack user
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({
      email,
      emailVerified: true,
    });
  }

  await auth.setCustomUserClaims(user.uid, {
    tenantId,
    slackUserId,
    role: 'owner',
  });

  // Generate custom token for client-side auth
  return auth.createCustomToken(user.uid);
}
```

### 4.3 Dashboard Auth Middleware

```typescript
// File: packages/scheduler/src/middleware/auth.ts

import { verifyToken } from '@glyphor/shared/auth';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const user = await verifyToken(token);

    // Attach tenant context to request
    req.user = user;
    req.tenantId = user.tenantId;

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Founder-only middleware (Glyphor internal access)
export async function founderMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.tenantId !== '00000000-0000-0000-0000-000000000000') {
    return res.status(403).json({ error: 'Founder access only' });
  }
  next();
}
```

### 4.4 Client-Side Auth (Dashboard)

```typescript
// File: packages/dashboard/src/lib/firebase.ts

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: 'ai-glyphor-company.firebaseapp.com',
  projectId: 'ai-glyphor-company',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Email/password login
export async function login(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user.getIdToken();
}

// Get current auth token for API calls
export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

// API client that auto-attaches auth
export async function apiCall(path: string, options: RequestInit = {}) {
  const token = await getAuthToken();
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}
```

---

## Part 5: Replace Supabase Storage with Google Cloud Storage

### 5.1 Create Storage Bucket

```bash
# Create bucket for agent outputs, avatars, customer files
gsutil mb -l us-central1 gs://glyphor-platform-assets

# Set CORS for dashboard access
cat > cors.json << 'EOF'
[
  {
    "origin": ["https://app.glyphor.ai", "http://localhost:3000"],
    "responseHeader": ["Content-Type", "Content-Range"],
    "method": ["GET", "HEAD", "PUT", "POST"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set cors.json gs://glyphor-platform-assets

# Create folder structure
gsutil cp /dev/null gs://glyphor-platform-assets/agents/avatars/.keep
gsutil cp /dev/null gs://glyphor-platform-assets/tenants/.keep
gsutil cp /dev/null gs://glyphor-platform-assets/exports/.keep
```

### 5.2 Storage Abstraction

```typescript
// File: packages/shared/src/storage.ts

import { Storage } from '@google-cloud/storage';

const storage = new Storage({ projectId: 'ai-glyphor-company' });
const bucket = storage.bucket('glyphor-platform-assets');

export async function uploadFile(
  path: string,
  content: Buffer | string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  const file = bucket.file(path);
  await file.save(content, { contentType });
  return `https://storage.googleapis.com/glyphor-platform-assets/${path}`;
}

export async function getSignedUrl(path: string, expiresInMinutes: number = 60): Promise<string> {
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

export async function downloadFile(path: string): Promise<Buffer> {
  const file = bucket.file(path);
  const [content] = await file.download();
  return content;
}

export async function deleteFile(path: string): Promise<void> {
  const file = bucket.file(path);
  await file.delete({ ignoreNotFound: true });
}

// Tenant-scoped upload (files organized by tenant)
export async function uploadTenantFile(
  tenantId: string,
  filename: string,
  content: Buffer | string,
  contentType: string
): Promise<string> {
  return uploadFile(`tenants/${tenantId}/${filename}`, content, contentType);
}
```

### 5.3 Migrate Existing Files from Supabase Storage

```bash
# List all files in Supabase storage
# Use Supabase dashboard or CLI to download

# Upload agent avatars to GCS
gsutil -m cp -r ./agent-avatars/* gs://glyphor-platform-assets/agents/avatars/

# Upload any other Supabase storage files
gsutil -m cp -r ./supabase-files/* gs://glyphor-platform-assets/migrated/
```

---

## Part 6: Cloud Tasks Worker Queue

### 6.1 Create the Cloud Tasks Queue

```bash
# Create the main agent run queue
gcloud tasks queues create agent-runs \
  --location=us-central1 \
  --max-dispatches-per-second=50 \
  --max-concurrent-dispatches=100 \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=300s

# Create a priority queue for founder directives and orchestration
gcloud tasks queues create agent-runs-priority \
  --location=us-central1 \
  --max-dispatches-per-second=20 \
  --max-concurrent-dispatches=50 \
  --max-attempts=5 \
  --min-backoff=5s \
  --max-backoff=120s

# Create a queue for delivery (Slack/Teams posting)
gcloud tasks queues create delivery \
  --location=us-central1 \
  --max-dispatches-per-second=10 \
  --max-concurrent-dispatches=50 \
  --max-attempts=3 \
  --min-backoff=5s \
  --max-backoff=60s
```

### 6.2 Scheduler Service (Enqueues Tasks)

```typescript
// File: packages/scheduler/src/queue/scheduler.ts

import { CloudTasksClient } from '@google-cloud/tasks';
import { systemQuery } from '@glyphor/shared/db';

const client = new CloudTasksClient();
const PROJECT = 'ai-glyphor-company';
const LOCATION = 'us-central1';
const WORKER_URL = process.env.WORKER_URL; // Cloud Run worker service URL

const QUEUE_AGENT_RUNS = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs`;
const QUEUE_PRIORITY = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs-priority`;
const QUEUE_DELIVERY = `projects/${PROJECT}/locations/${LOCATION}/queues/delivery`;

// Main scheduler loop - runs every 60 seconds via Cloud Scheduler
export async function scheduleAgentRuns() {
  // Get all active tenants
  const tenants = await systemQuery(
    `SELECT id, product, status FROM tenants WHERE status = 'active'`
  );

  for (const tenant of tenants) {
    // Get agents due for a run
    const agents = await systemQuery(
      `SELECT ta.agent_role, ta.model_tier, ta.schedule_cron, ta.last_run_at
       FROM tenant_agents ta
       WHERE ta.tenant_id = $1
         AND ta.is_active = true
         AND (ta.last_run_at IS NULL OR ta.last_run_at < NOW() - INTERVAL '1 hour')
       ORDER BY ta.last_run_at ASC NULLS FIRST`,
      [tenant.id]
    );

    for (const agent of agents) {
      await enqueueAgentRun({
        tenantId: tenant.id,
        agentRole: agent.agent_role,
        modelTier: agent.model_tier,
        taskType: 'heartbeat',
      });
    }
  }

  // Check for pending directives
  const directives = await systemQuery(
    `SELECT id, tenant_id FROM founder_directives
     WHERE status = 'pending'
     ORDER BY created_at ASC`
  );

  for (const directive of directives) {
    await enqueueAgentRun({
      tenantId: directive.tenant_id,
      agentRole: 'chief-of-staff',
      taskType: 'orchestrate',
      priority: true,
      metadata: { directiveId: directive.id },
    });
  }
}

async function enqueueAgentRun(params: {
  tenantId: string;
  agentRole: string;
  modelTier?: string;
  taskType: string;
  priority?: boolean;
  metadata?: Record<string, any>;
}) {
  const queue = params.priority ? QUEUE_PRIORITY : QUEUE_AGENT_RUNS;
  const jitterSeconds = Math.floor(Math.random() * 30); // Spread load

  await client.createTask({
    parent: queue,
    task: {
      httpRequest: {
        url: `${WORKER_URL}/run`,
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: process.env.WORKER_SERVICE_ACCOUNT,
        },
      },
      scheduleTime: {
        seconds: Math.floor(Date.now() / 1000) + jitterSeconds,
      },
    },
  });
}

// Enqueue a delivery task (posting to Slack/Teams)
export async function enqueueDelivery(params: {
  tenantId: string;
  agentRole: string;
  channel: string;
  content: string;
  platform: string;
}) {
  await client.createTask({
    parent: QUEUE_DELIVERY,
    task: {
      httpRequest: {
        url: `${WORKER_URL}/deliver`,
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: process.env.WORKER_SERVICE_ACCOUNT,
        },
      },
    },
  });
}
```

### 6.3 Worker Service (Executes Tasks)

```typescript
// File: packages/worker/src/index.ts

import express from 'express';
import { tenantQuery, systemQuery } from '@glyphor/shared/db';
import { deliverOutput } from './delivery/router';
import { executeAgentRun } from './runtime/executor';
import { trackAgentRun } from './metrics';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Agent run endpoint (called by Cloud Tasks)
app.post('/run', async (req, res) => {
  const { tenantId, agentRole, taskType, modelTier, metadata } = req.body;
  const startTime = Date.now();

  try {
    // Load tenant and agent configuration
    const [tenant] = await systemQuery(
      'SELECT * FROM tenants WHERE id = $1', [tenantId]
    );
    const [agent] = await systemQuery(
      'SELECT * FROM tenant_agents WHERE tenant_id = $1 AND agent_role = $2',
      [tenantId, agentRole]
    );

    if (!tenant || !agent) {
      console.error(`Missing tenant or agent: ${tenantId}/${agentRole}`);
      return res.status(404).json({ error: 'Not found' });
    }

    // Execute the agent run
    const result = await executeAgentRun({
      tenant,
      agent,
      taskType,
      modelTier: modelTier || agent.model_tier,
      metadata,
    });

    // Track metrics
    await trackAgentRun({
      tenantId,
      agentRole,
      model: result.model,
      provider: result.provider,
      durationMs: Date.now() - startTime,
      tokensUsed: result.tokensUsed,
      status: 'success',
    });

    // Update last_run_at
    await systemQuery(
      'UPDATE tenant_agents SET last_run_at = NOW() WHERE tenant_id = $1 AND agent_role = $2',
      [tenantId, agentRole]
    );

    // If agent produced output, enqueue delivery
    if (result.output && agent.delivery_channel) {
      // Delivery happens async via delivery queue
      const { enqueueDelivery } = await import('../scheduler/src/queue/scheduler');
      await enqueueDelivery({
        tenantId,
        agentRole,
        channel: agent.delivery_channel,
        content: result.output,
        platform: 'slack', // Determined by tenant workspace
      });
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`Agent run failed: ${tenantId}/${agentRole}`, error);

    await trackAgentRun({
      tenantId,
      agentRole,
      model: modelTier || 'unknown',
      provider: 'unknown',
      durationMs: Date.now() - startTime,
      tokensUsed: 0,
      status: 'failed',
      error: error.message,
    });

    // Return 500 so Cloud Tasks retries
    res.status(500).json({ error: error.message });
  }
});

// Delivery endpoint (called by Cloud Tasks delivery queue)
app.post('/deliver', async (req, res) => {
  const { tenantId, agentRole, channel, content, platform } = req.body;

  try {
    await deliverOutput(tenantId, agentRole, channel, content);
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`Delivery failed: ${tenantId}/${agentRole}`, error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Worker listening on port ${PORT}`));
```

### 6.4 Deploy Worker as Separate Cloud Run Service

```bash
# Build and deploy worker
gcloud run deploy glyphor-worker \
  --source=./packages/worker \
  --region=us-central1 \
  --platform=managed \
  --min-instances=1 \
  --max-instances=100 \
  --concurrency=10 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --add-cloudsql-instances=ai-glyphor-company:us-central1:glyphor-db \
  --set-env-vars="DB_HOST=/cloudsql/ai-glyphor-company:us-central1:glyphor-db,DB_NAME=glyphor,DB_USER=glyphor_app" \
  --set-secrets="DB_PASSWORD=db-password:latest,OPENAI_API_KEY=openai-key:latest,ANTHROPIC_API_KEY=anthropic-key:latest,GOOGLE_AI_KEY=google-ai-key:latest" \
  --no-allow-unauthenticated  # Only Cloud Tasks can call this

# Set up Cloud Scheduler to trigger the scheduler loop every 60 seconds
gcloud scheduler jobs create http scheduler-tick \
  --location=us-central1 \
  --schedule="* * * * *" \
  --uri="https://glyphor-scheduler-<hash>-uc.a.run.app/scheduler/tick" \
  --http-method=POST \
  --oidc-service-account-email=<SCHEDULER_SERVICE_ACCOUNT>
```

---

## Part 7: Environment Variables Update

### 7.1 Remove All Supabase References

Delete these from Cloud Run environment and Secret Manager:
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
SUPABASE_POOLER_URL
```

### 7.2 New Environment Variables

**Scheduler service:**
```env
# Database
DB_HOST=/cloudsql/ai-glyphor-company:us-central1:glyphor-db
DB_NAME=glyphor
DB_USER=glyphor_app
DB_PASSWORD=<from Secret Manager>

# Firebase
FIREBASE_CLIENT_EMAIL=<from Secret Manager>
FIREBASE_PRIVATE_KEY=<from Secret Manager>

# Worker
WORKER_URL=https://glyphor-worker-<hash>-uc.a.run.app
WORKER_SERVICE_ACCOUNT=glyphor-worker@ai-glyphor-company.iam.gserviceaccount.com

# Existing (unchanged)
OPENAI_API_KEY=<from Secret Manager>
ANTHROPIC_API_KEY=<from Secret Manager>
GOOGLE_AI_KEY=<from Secret Manager>
REDIS_URL=<existing>
STRIPE_SECRET_KEY=<from Secret Manager>
```

**Worker service:**
```env
# Database
DB_HOST=/cloudsql/ai-glyphor-company:us-central1:glyphor-db
DB_NAME=glyphor
DB_USER=glyphor_app
DB_PASSWORD=<from Secret Manager>

# LLM Providers
OPENAI_API_KEY=<from Secret Manager>
ANTHROPIC_API_KEY=<from Secret Manager>
GOOGLE_AI_KEY=<from Secret Manager>

# Slack
SLACK_BOT_TOKEN=<from Secret Manager>
SLACK_SIGNING_SECRET=<from Secret Manager>

# Redis
REDIS_URL=<existing>
```

---

## Part 8: Migration Checklist

### Pre-Migration
- [ ] Take full Supabase backup via pg_dump
- [ ] Document all Supabase environment variables
- [ ] Audit codebase for all `supabase` import/usage (grep -r "supabase" packages/)
- [ ] Create Cloud SQL instance
- [ ] Create GCS bucket
- [ ] Set up Firebase Auth in GCP console
- [ ] Store all new secrets in Secret Manager

### Database Migration
- [ ] Export Supabase database (pg_dump)
- [ ] Import to Cloud SQL
- [ ] Verify table count matches (86+ tables)
- [ ] Verify row counts on critical tables
- [ ] Run Migration 001: tenant tables
- [ ] Run Migration 002: add tenant_id columns + indexes
- [ ] Run Migration 003: enable RLS + create policies
- [ ] Run Migration 004: seed Glyphor as tenant 0 + backfill data
- [ ] Verify RLS works (test tenant-scoped query returns only tenant data)
- [ ] Verify system query bypasses RLS correctly

### Code Migration
- [ ] Create packages/shared/src/db.ts (database abstraction layer)
- [ ] Create packages/shared/src/auth.ts (Firebase auth)
- [ ] Create packages/shared/src/storage.ts (GCS)
- [ ] Replace ALL supabase.from() calls with tenantQuery/systemQuery
- [ ] Replace ALL supabase auth calls with Firebase auth
- [ ] Replace ALL supabase storage calls with GCS
- [ ] Remove @supabase/supabase-js from all package.json files
- [ ] Update all import statements
- [ ] Create packages/worker/src/index.ts (new worker service)
- [ ] Create scheduler queue integration (Cloud Tasks)
- [ ] Update scheduler to use Cloud Scheduler tick

### Infrastructure
- [ ] Deploy updated scheduler to Cloud Run with Cloud SQL connection
- [ ] Deploy new worker service to Cloud Run
- [ ] Create Cloud Tasks queues (agent-runs, agent-runs-priority, delivery)
- [ ] Create Cloud Scheduler job (scheduler-tick, every 60s)
- [ ] Update IAM: Cloud Run service account → Cloud SQL client role
- [ ] Update IAM: Cloud Tasks → Cloud Run invoker role
- [ ] Set up Cloud Monitoring alerts

### Verification
- [ ] Run smoke test suite — target: 31+ tests passing (no regression)
- [ ] Verify Glyphor internal agents still running on heartbeat
- [ ] Verify dashboard loads and shows agent data
- [ ] Verify agent runs execute and log correctly
- [ ] Verify knowledge graph queries work with tenant isolation
- [ ] Verify no Supabase references remain in codebase
- [ ] Verify no Supabase environment variables remain
- [ ] Monitor Cloud SQL connection count and query latency for 24 hours

### Post-Migration Cleanup
- [ ] Cancel Supabase Pro subscription
- [ ] Delete Supabase project (after 30-day verification period)
- [ ] Remove supabase CLI configuration
- [ ] Update ARCHITECTURE.md to reflect new stack
- [ ] Update any CI/CD pipelines that reference Supabase

---

## Part 9: Rollback Plan

If anything goes critically wrong during migration:

1. All Cloud Run services have previous revisions. Roll back via:
```bash
gcloud run services update-traffic glyphor-scheduler --to-revisions=<previous-revision>=100
```

2. Supabase database remains untouched during migration. Simply revert environment variables to point back to Supabase.

3. Keep Supabase project active for 30 days after migration as a safety net.

**Critical: Do not delete any Supabase data until the new system has been running for at least 30 days with zero issues.**

---

## Part 10: Cost Comparison

| Service | Supabase (current) | GCP (after migration) |
|---------|-------------------|----------------------|
| Database | $25/mo (Pro) | ~$100/mo (Cloud SQL db-custom-2-8192) |
| Auth | Included | $0 (Firebase free tier: 50K MAU) |
| Storage | Included | ~$2/mo (GCS, minimal usage) |
| API (PostgREST) | Included | $0 (custom routes in existing Cloud Run) |
| Cloud Run | ~$50/mo | ~$50/mo (unchanged) |
| Cloud Tasks | N/A | ~$0.40/mo per million tasks |
| Cloud Scheduler | N/A | ~$0.10/mo per job |
| **Total** | **~$75/mo** | **~$155/mo** |

The ~$80/mo increase buys you: full infrastructure control, enterprise-grade HA with regional failover, 14-day point-in-time recovery, no vendor dependency, clean GCP-only story for investors and customers, and the ability to scale to 5,000 customers without re-platforming.

At $500/mo per customer, you need 1 customer to pay for the infrastructure.