# Company Memory Schema

> Last updated: 2025-02-22

The company memory is the shared knowledge layer that all AI agents read from and write to.
Implemented in `packages/company-memory/src/store.ts` as `CompanyMemoryStore`.

---

## Storage Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Structured data | Supabase (PostgreSQL) | Queryable records — profiles, metrics, decisions, activity |
| Large documents | Google Cloud Storage | Briefings, reports, specs, analysis documents |
| Static knowledge | Markdown files on disk | Company knowledge base + agent briefs (read-only at runtime) |

---

## Supabase Tables (9 tables)

### `company_profile`

Company-wide configuration and identity.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Identifier (e.g. `glyphor-main`) |
| `name` | text | Company name |
| `vision` | text | Company vision statement |
| `mission` | text | Mission statement |
| `okrs` | jsonb | Quarterly OKRs |
| `founders` | jsonb | Founder profiles, focus areas, timezones |
| `culture_values` | jsonb | Array of culture values |
| `updated_at` | timestamptz | Last update |

### `products`

Product catalogue with current state and metrics.

| Column | Type | Description |
|--------|------|-------------|
| `slug` | text PK | URL-safe identifier (`fuse`, `pulse`) |
| `name` | text | Display name |
| `status` | text | `active`, `beta`, `concept`, `sunset` |
| `description` | text | Product description |
| `tech_stack` | jsonb | Technologies used |
| `metrics` | jsonb | MRR, active users, build stats |
| `updated_at` | timestamptz | Last update |

### `company_agents`

Agent roster and runtime status.

| Column | Type | Description |
|--------|------|-------------|
| `role` | text PK | Agent role identifier (`chief-of-staff`, `cto`, etc.) |
| `name` | text | Display name (codename — Atlas, Forge, etc.) |
| `status` | text | `active`, `stub`, `disabled` |
| `model` | text | LLM model used (`gemini-3-flash-preview`) |
| `schedule` | text | Cron / schedule description |
| `last_run` | timestamptz | Last execution time |
| `config` | jsonb | Agent-specific configuration |

### `decisions`

Decision queue for the authority model.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Decision identifier |
| `tier` | text | `green`, `yellow`, `red` |
| `status` | text | `pending`, `approved`, `rejected`, `discussed` |
| `title` | text | Decision title |
| `summary` | text | Decision description |
| `proposed_by` | text | Agent role that proposed it |
| `reasoning` | text | Agent's reasoning for the decision |
| `data` | jsonb | Supporting data |
| `assigned_to` | jsonb | Array of founder names (`["kristina"]`, `["andrew"]`, `["kristina","andrew"]`) |
| `resolved_by` | text | Who resolved it |
| `resolution_note` | text | Resolution comment |
| `created_at` | timestamptz | When proposed |
| `resolved_at` | timestamptz | When resolved |

### `activity_log`

All agent actions for audit trail.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `agent_role` | text | Which agent acted |
| `action` | text | `analysis`, `decision`, `alert`, `content`, `deploy`, `briefing`, `outreach` |
| `product` | text | Which product (`fuse`, `pulse`) or `company` |
| `summary` | text | Action summary |
| `details` | jsonb | Additional details |
| `tier` | text | Decision tier if applicable |
| `created_at` | timestamptz | When it happened |

### `competitive_intel`

Competitor tracking and market intelligence.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `competitor` | text | Competitor name |
| `category` | text | Intel category |
| `summary` | text | Intelligence summary |
| `source` | text | Where it came from |
| `data` | jsonb | Structured data |
| `created_at` | timestamptz | When gathered |

### `customer_health`

Customer health scoring for churn prediction.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `customer_id` | text | Customer identifier |
| `product` | text | Product slug |
| `health_score` | numeric | 0-100 health score |
| `churn_risk` | text | `low`, `medium`, `high`, `critical` |
| `signals` | jsonb | Health signal data |
| `updated_at` | timestamptz | Last scored |

### `financials`

Financial metrics time series.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `date` | date | Metric date |
| `product` | text | Product slug |
| `metric` | text | Metric name (`mrr`, `arr`, `costs`, `margin`, etc.) |
| `value` | numeric | Metric value |
| `data` | jsonb | Additional breakdown |

### `product_proposals`

New product/feature proposals from agents.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `title` | text | Proposal title |
| `proposed_by` | text | Agent role |
| `status` | text | `draft`, `proposed`, `approved`, `rejected` |
| `summary` | text | Proposal summary |
| `analysis` | jsonb | Supporting analysis |
| `created_at` | timestamptz | When proposed |

---

## GCS Bucket Structure

Bucket name: `glyphor-company` (configured via `GCS_BUCKET` env var).

```
gs://glyphor-company/
├── briefings/
│   ├── kristina/
│   │   └── 2025-02-22.md
│   └── andrew/
│       └── 2025-02-22.md
├── reports/
│   ├── financial/
│   ├── competitive/
│   └── product/
└── specs/
    ├── product/
    └── technical/
```

---

## Namespace Keys

Used by `CompanyMemoryStore` for key-value access patterns on top of Supabase rows.

| Prefix | Examples | Table |
|--------|----------|-------|
| `company.*` | `company.profile`, `company.okrs`, `company.culture` | `company_profile` |
| `product.*` | `product.fuse.metrics`, `product.pulse.status` | `products` |
| `agent.*` | `agent.cto.last_run`, `agent.cfo.config` | `company_agents` |
| `decision.pending.*` | `decision.pending.{id}` | `decisions` (status=pending) |
| `decision.resolved.*` | `decision.resolved.{id}` | `decisions` (status=approved/rejected) |
| `metric.*` | `metric.mrr.fuse`, `metric.costs.infra` | `financials` |
| `intel.*` | `intel.competitor.{name}`, `intel.market.{segment}` | `competitive_intel` |
| `activity.*` | `activity.decision.{id}` | `activity_log` |

---

## IMemoryBus Interface

The `IMemoryBus` interface (defined in `packages/agent-runtime/src/types.ts`) is how
agent tools interact with company memory:

```typescript
interface IMemoryBus {
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown, agentId: string): Promise<void>;
  appendActivity(entry: ActivityLogEntry): Promise<void>;
  createDecision(decision: Omit<CompanyDecision, 'id' | 'createdAt'>): Promise<string>;
  getDecisions(filter?: { tier?: DecisionTier; status?: DecisionStatus }): Promise<CompanyDecision[]>;
  getRecentActivity(hours?: number): Promise<ActivityLogEntry[]>;
  getProductMetrics(slug: ProductSlug): Promise<ProductMetrics | null>;
  getFinancials(days?: number): Promise<FinancialSnapshot[]>;
}
```

### Key Types

| Type | Fields |
|------|--------|
| `ActivityLogEntry` | `agentRole`, `action`, `product?`, `summary`, `details?`, `tier?`, `createdAt` |
| `CompanyDecision` | `id`, `tier`, `status`, `title`, `summary`, `proposedBy`, `reasoning`, `data?`, `assignedTo`, `resolvedBy?`, `resolutionNote?`, `createdAt`, `resolvedAt?` |
| `ProductMetrics` | `slug`, `name`, `status`, `mrr?`, `activeUsers?`, `buildsLast7d?`, `buildSuccessRate?` |
| `FinancialSnapshot` | `date`, `product?`, `mrr`, `infraCost`, `apiCost`, `margin` |
| `BriefingData` | `recipient`, `date`, `metrics[]`, `greenItems[]`, `yellowItems[]`, `redItems[]`, `highlights[]`, `actionRequired[]` |
| `DecisionTier` | `'green' \| 'yellow' \| 'red'` |
| `DecisionStatus` | `'pending' \| 'approved' \| 'rejected' \| 'discussed'` |
| `ProductSlug` | `'fuse' \| 'pulse'` |

---

## Static Knowledge (Read-Only)

In addition to Supabase and GCS, agents receive company context via markdown files
at the system prompt level. These are NOT stored in the database — they are read from
disk at runtime by `CompanyAgentRunner.buildSystemPrompt()`.

| File | Purpose |
|------|---------|
| `packages/company-knowledge/COMPANY_KNOWLEDGE_BASE.md` | ~400 lines of shared truth: founders, products, metrics, competitors, authority tiers, infrastructure, comms rules |
| `packages/company-knowledge/briefs/atlas.md` | Chief of Staff role brief |
| `packages/company-knowledge/briefs/forge.md` | CTO role brief |
| `packages/company-knowledge/briefs/ledger.md` | CFO role brief |
| `packages/company-knowledge/briefs/compass.md` | CPO role brief |
| `packages/company-knowledge/briefs/beacon.md` | CMO role brief |
| `packages/company-knowledge/briefs/harbor.md` | VP CS role brief |
| `packages/company-knowledge/briefs/closer.md` | VP Sales role brief |

These files are copied into the Docker image at build time (`Dockerfile.scheduler`
runs `COPY packages/company-knowledge/ packages/company-knowledge/`). To update them,
rebuild and redeploy the scheduler image with `--no-cache`.

---

## Supabase Connection

| Setting | Value |
|---------|-------|
| **URL** | `https://ztucrgzcoaryzuvkcaif.supabase.co` |
| **Server-side key** | `SUPABASE_SERVICE_KEY` (stored in GCP Secret Manager) |
| **Client-side key** | `VITE_SUPABASE_ANON_KEY` (baked into dashboard build) |
| **Migrations** | `supabase/migrations/` (3 files) |
