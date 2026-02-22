# Company Memory Schema

The company memory is the shared knowledge layer that all AI agents read from and write to.

## Storage Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Structured data | Supabase (PostgreSQL) | Queryable records — profiles, metrics, decisions, activity |
| Large documents | Google Cloud Storage | Briefings, reports, specs, analysis documents |

## Supabase Tables

### `company_profile`
Company-wide configuration and identity.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | Identifier (e.g. "glyphor-main") |
| name | text | Company name |
| vision | text | Company vision statement |
| mission | text | Mission statement |
| okrs | jsonb | Quarterly OKRs |
| founders | jsonb | Founder profiles, focus areas, timezones |
| culture_values | jsonb | Array of culture values |
| updated_at | timestamptz | Last update |

### `products`
Product catalog with current state and metrics.

| Column | Type | Description |
|--------|------|-------------|
| slug | text PK | URL-safe identifier (fuse, pulse) |
| name | text | Display name |
| status | text | active, beta, concept, sunset |
| description | text | Product description |
| tech_stack | jsonb | Technologies used |
| metrics | jsonb | MRR, active users, build stats |
| updated_at | timestamptz | Last update |

### `company_agents`
Agent roster and status.

| Column | Type | Description |
|--------|------|-------------|
| role | text PK | Agent role identifier |
| name | text | Display name |
| status | text | active, stub, disabled |
| model | text | LLM model used |
| schedule | text | Cron/schedule description |
| last_run | timestamptz | Last execution time |
| config | jsonb | Agent-specific config |

### `decisions`
Decision queue for authority model.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | Decision identifier |
| tier | text | green, yellow, red |
| status | text | pending, approved, rejected, discussed |
| title | text | Decision title |
| summary | text | Decision description |
| proposed_by | text | Agent role that proposed it |
| reasoning | text | Agent's reasoning |
| data | jsonb | Supporting data |
| assigned_to | jsonb | Array of founder names |
| resolved_by | text | Who resolved it |
| resolution_note | text | Resolution comment |
| created_at | timestamptz | When proposed |
| resolved_at | timestamptz | When resolved |

### `activity_log`
All agent actions for audit trail.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| agent_role | text | Which agent acted |
| action | text | analysis, decision, alert, content, deploy, briefing, outreach |
| product | text | Which product (or "company") |
| summary | text | Action summary |
| details | jsonb | Additional details |
| tier | text | Decision tier if applicable |
| created_at | timestamptz | When it happened |

### `competitive_intel`
Competitor tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| competitor | text | Competitor name |
| category | text | Intel category |
| summary | text | Intelligence summary |
| source | text | Where it came from |
| data | jsonb | Structured data |
| created_at | timestamptz | When gathered |

### `customer_health`
Customer health scoring for churn prediction.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| customer_id | text | Customer identifier |
| product | text | Product slug |
| health_score | numeric | 0-100 health score |
| churn_risk | text | low, medium, high, critical |
| signals | jsonb | Health signals data |
| updated_at | timestamptz | Last scored |

### `financials`
Financial metrics time series.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| date | date | Metric date |
| product | text | Product slug |
| metric | text | Metric name (mrr, arr, costs, etc.) |
| value | numeric | Metric value |
| data | jsonb | Additional breakdown |

### `product_proposals`
New product/feature proposals from agents.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| title | text | Proposal title |
| proposed_by | text | Agent role |
| status | text | draft, proposed, approved, rejected |
| summary | text | Proposal summary |
| analysis | jsonb | Supporting analysis |
| created_at | timestamptz | When proposed |

## GCS Bucket Structure

```
gs://{bucket}/
├── briefings/
│   ├── kristina/
│   │   └── 2025-01-15.md
│   └── andrew/
│       └── 2025-01-15.md
├── reports/
│   ├── financial/
│   ├── competitive/
│   └── product/
└── specs/
    ├── product/
    └── technical/
```

## Namespace Keys

Used by `CompanyMemoryStore` for key-value access patterns:

| Prefix | Examples |
|--------|----------|
| `company.*` | company.profile, company.okrs, company.culture |
| `product.*` | product.fuse.metrics, product.pulse.status |
| `agent.*` | agent.cto.last_run, agent.cfo.config |
| `decision.*` | decision.pending.{id}, decision.resolved.{id} |
| `metric.*` | metric.mrr.fuse, metric.costs.infra |
| `intel.*` | intel.competitor.{name}, intel.market.{segment} |
