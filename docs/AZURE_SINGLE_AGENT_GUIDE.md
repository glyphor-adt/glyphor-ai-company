# Building a Brand Compliance AI Agent on Azure

> A guide for deploying an autonomous AI brand compliance agent (Cassandra Voss) into
> Eaton's Azure environment. One agent, Azure-native, Graph API for Teams.

---

## Table of Contents

1. [What You're Building](#what-youre-building)
2. [Azure Resources Required](#azure-resources-required)
3. [Entra ID & Permissions](#entra-id--permissions)
4. [Teams Setup](#teams-setup)
5. [Database Schema](#database-schema)
6. [Knowledge Graph & GraphRAG](#knowledge-graph--graphrag)
7. [Project Structure](#project-structure)
8. [Agent Anatomy — The Four Files](#agent-anatomy--the-four-files)
9. [Agent Runtime — The Execution Loop](#agent-runtime--the-execution-loop)
10. [Deployment](#deployment)
11. [Cost Estimate](#cost-estimate)

---

## What You're Building

A single AI agent persona — **Cassandra Voss, Brand Compliance & Identity Manager** — that:

- **Runs on a schedule** — daily brand audits, weekly compliance reports
- **Responds on demand** — review a campaign brief, check a logo, answer brand questions
- **Persists memory** — remembers past violations, rulings, and brand precedents
- **Posts to Teams** — sends compliance reports and violation alerts to channels
- **Calls LLMs** — Azure OpenAI (GPT-5.2 / GPT-5.2-mini) for reasoning
- **Has tools** — can fetch web pages, analyze documents & images, query the knowledge graph, send messages

This is NOT a chatbot. It's an autonomous agent with a persistent identity, memory, scheduled
work cycles, and the ability to take actions in your enterprise environment.

---

## Azure Resources Required

### Core (Must-Have)

| Resource | SKU / Tier | Purpose |
|----------|-----------|---------|
| **Azure Container Apps** | Consumption plan | Hosts the agent scheduler service (the "brain"). Scales to zero when idle, wakes on cron/HTTP. |
| **Azure OpenAI Service** | S0 (Standard) | LLM inference. Deploy `gpt-5.2` for quality or `gpt-5.2-mini` for cost. This is your agent's "thinking" engine. |
| **Azure Database for PostgreSQL** | Flexible Server, Burstable B1ms | Agent memory, activity log, agent config. 5 core tables + optional Knowledge Graph tables. Enable `pgvector` extension for KG embeddings. |
| **Azure Key Vault** | Standard | Store all secrets: API keys, DB connection strings, Entra app credentials. Never hardcode. |
| **Azure Container Registry** | Basic | Store your Docker images. |
| **Entra ID App Registration** | Free (included with M365) | Service principal for Graph API (Teams, email). |

### Supporting (Recommended)

| Resource | SKU / Tier | Purpose |
|----------|-----------|---------|
| **Azure Blob Storage** | Standard LRS, Hot tier | Archive compliance reports, brand assets, large documents. |
| **Azure Log Analytics** | Pay-per-GB | Centralized logging for agent runs, errors, LLM costs. |
| **Azure Application Insights** | (auto-created with Log Analytics) | Request tracing, performance monitoring. |
| **Azure Static Web Apps** | Free tier | Host the dashboard UI (React SPA). |

### NOT Needed for v1

| Resource | Why Not |
|----------|---------|

| Azure Communication Services | Only needed for voice/calling |
| Azure Service Bus | Container Apps has built-in job scheduling; simple HTTP works for one agent |
| Azure Functions | Container Apps is more flexible for a long-running agent service |

### Resource Group Layout

```
rg-ai-agent-sandbox/
├── acr-aiagent                    # Container Registry
├── cae-aiagent-env                # Container Apps Environment
├── ca-agent-scheduler             # Container App (your service)
├── openai-aiagent                 # Azure OpenAI account
│   ├── gpt-5.2 deployment         #   Chat/reasoning model
│   └── text-embedding-3-small     #   Embedding model (memory + KG)
├── psql-aiagent                   # PostgreSQL Flexible Server (+ pgvector)
├── kv-aiagent                     # Key Vault
├── st-aiagent                     # Storage Account (blob)
├── log-aiagent                    # Log Analytics Workspace
├── appi-aiagent                   # Application Insights
└── swa-aiagent-dashboard          # Static Web App (dashboard)
```

---

## Entra ID & Permissions

You need **two** Entra ID app registrations:

### App 1: Agent Service Principal (backend)

This is the identity your agent service uses to call Microsoft Graph API.

**Create the registration:**
1. Azure Portal → Entra ID → App registrations → New registration
2. Name: `ai-agent-service`
3. Supported account types: "Accounts in this organizational directory only" (Single tenant)
4. No redirect URI needed

**API Permissions (Application, NOT delegated):**

| Permission | Type | Why |
|-----------|------|-----|
| `Teamwork.Migrate.All` | Application | Send messages to Teams channels |
| `Channel.ReadBasic.All` | Application | List channels in a team |
| `ChannelMember.Read.All` | Application | Read channel members |
| `Group.Read.All` | Application | Read team metadata |
| `Chat.ReadWrite.All` | Application | Send DMs to users (1:1 chat) |
| `Mail.Send` | Application | Send email on behalf of agent mailbox |
| `Mail.Read` | Application | Read agent's inbox |
| `Calendars.ReadWrite` | Application | Schedule meetings |
| `User.Read.All` | Application | Look up user profiles |

> **Admin consent required.** An Entra Global Admin or Privileged Role Administrator must
> grant admin consent for these application permissions.

**Client secret:**
1. Certificates & secrets → New client secret
2. Set expiration to 24 months
3. Store in Key Vault immediately — you'll need `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

### App 2: Dashboard SPA (frontend, optional for v1)

Only needed if you build the web dashboard.

1. Name: `ai-agent-dashboard`
2. SPA redirect URI: `https://your-dashboard-url.azurestaticapps.net`
3. Delegated permissions: `User.Read`
4. Enable "ID tokens" under Authentication

### Azure RBAC Roles (on Azure Resources)

The Container App's managed identity needs:

| Role | Scope | Why |
|------|-------|-----|
| `Key Vault Secrets User` | Key Vault | Read secrets at runtime |
| `Cognitive Services OpenAI User` | OpenAI resource | Call GPT models |
| `Storage Blob Data Contributor` | Storage account | Read/write compliance reports and brand assets |
| `AcrPull` | Container Registry | Pull images |

```bash
# Example: Assign roles to Container App managed identity
PRINCIPAL_ID=$(az containerapp show -n ca-agent-scheduler -g rg-ai-agent-sandbox --query identity.principalId -o tsv)

az role assignment create --assignee $PRINCIPAL_ID \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/{sub}/resourceGroups/rg-ai-agent-sandbox/providers/Microsoft.KeyVault/vaults/kv-aiagent

az role assignment create --assignee $PRINCIPAL_ID \
  --role "Cognitive Services OpenAI User" \
  --scope /subscriptions/{sub}/resourceGroups/rg-ai-agent-sandbox/providers/Microsoft.CognitiveServices/accounts/openai-aiagent
```

### Who Needs to Help You

| Person/Role | What They Do |
|-------------|-------------|
| **Entra Global Admin** | Grant admin consent for Graph API permissions |
| **Subscription Owner/Contributor** | Create the Azure resources, assign RBAC roles |
| **Teams Admin** | Install the Teams bot app in the org (later) |
| **M365 Admin** | Create the shared mailbox for the agent (optional) |

---

## Teams Setup

Your agent posts to Teams channels via **Microsoft Graph API** using app-only
authentication (Entra ID client credentials flow). This requires the Entra app
registration from the previous section with `ChannelMessage.Send` (or `Teamwork.Migrate.All`)
permission and admin consent.

1. Register the Entra app (see above) and grant admin consent for Graph permissions
2. Find your **Team ID** and **Channel ID** — run `GET /me/joinedTeams` and `GET /teams/{id}/channels`
   in Graph Explorer, or use the code below to list channels
3. Store `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` in Key Vault
4. Store `TEAMS_TEAM_ID` and `TEAMS_CHANNEL_ID` as env vars (or Key Vault secrets)

```typescript
import { ConfidentialClientApplication } from '@azure/msal-node';

interface ChannelTarget {
  teamId: string;
  channelId: string;
}

class GraphTeamsClient {
  private msalApp: ConfidentialClientApplication;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(tenantId: string, clientId: string, clientSecret: string) {
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }

  static fromEnv(): GraphTeamsClient {
    return new GraphTeamsClient(
      process.env.AZURE_TENANT_ID!,
      process.env.AZURE_CLIENT_ID!,
      process.env.AZURE_CLIENT_SECRET!,
    );
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }
    const result = await this.msalApp.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    if (!result?.accessToken) throw new Error('Failed to acquire Graph token');
    this.cachedToken = { token: result.accessToken, expiresAt: result.expiresOn?.getTime() ?? now + 3600_000 };
    return result.accessToken;
  }

  async sendText(target: ChannelTarget, content: string): Promise<void> {
    const token = await this.getToken();
    const url = `https://graph.microsoft.com/v1.0/teams/${target.teamId}/channels/${target.channelId}/messages`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { contentType: 'text', content } }),
    });
    if (!resp.ok) throw new Error(`Graph send failed (${resp.status}): ${await resp.text()}`);
  }
}
```

> **Dependency:** `npm install @azure/msal-node`

---

## Database Schema

Five tables are all you need to prove out a single agent.

```sql
-- 1. Agent roster
CREATE TABLE company_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT UNIQUE NOT NULL,            -- 'brand-agent'
  display_name TEXT NOT NULL,           -- 'Cassandra Voss'
  model TEXT NOT NULL,                  -- 'gpt-5.2'
  status TEXT DEFAULT 'active',
  last_run_at TIMESTAMPTZ,
  total_runs INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Agent run history
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  task TEXT NOT NULL,                    -- 'brand_audit', 'on_demand'
  status TEXT DEFAULT 'running',        -- running | completed | failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  model_used TEXT,
  input_tokens INT,
  output_tokens INT,
  result TEXT,
  error TEXT
);

-- 3. Agent memory (simple text — no embeddings needed for v1)
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,               -- 'observation', 'decision', 'learning'
  content TEXT NOT NULL,
  importance DECIMAL(3,2) DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Activity log
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Chat messages (if you build a web dashboard)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'user' | 'assistant'
  content TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed your agent
INSERT INTO company_agents (role, display_name, model, status)
VALUES ('brand-agent', 'Cassandra Voss', 'gpt-5.2', 'active');
```

> **Later:** Add `pgvector`, embeddings, and vector search when you want semantic memory recall
> instead of keyword search. The Knowledge Graph section below shows that pattern.

---

## Knowledge Graph & GraphRAG

The knowledge graph gives your agent **structured understanding** of how things relate —
not just flat memory, but a web of entities, relationships, and causal chains.

### Why a Knowledge Graph?

| Without KG | With KG |
|-----------|---------|
| Agent remembers "Revenue dropped 15%" | Agent traces: Revenue dropped → because churn spiked → because onboarding broke → caused by deploy on Jan 5 |
| Flat keyword search over memories | Semantic search + N-hop graph expansion (finds related context) |
| Each memory is isolated | Memories are connected — agent sees patterns across domains |
| Agent forgets relationships | Agent can trace cause → effect chains across time |

### Core Tables

```sql
-- Knowledge graph nodes (entities, events, facts, decisions, etc.)
CREATE TABLE kg_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type TEXT NOT NULL,        -- 'event', 'fact', 'entity', 'decision', 'metric',
                                  -- 'goal', 'risk', 'pattern', 'observation', 'action'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  department TEXT,                -- 'engineering', 'finance', 'product', etc.
  importance DECIMAL(3,2) DEFAULT 0.5,
  source_agent TEXT,              -- which agent created this
  source_type TEXT DEFAULT 'agent',  -- 'agent', 'graphrag', 'manual'
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_kg_nodes_embedding ON kg_nodes USING ivfflat (embedding vector_cosine_ops);

-- Knowledge graph edges (relationships between nodes)
CREATE TABLE kg_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,        -- 'caused', 'supports', 'contradicts', 'depends_on',
                                  -- 'belongs_to', 'affects', 'mitigates', 'monitors',
                                  -- 'owns', 'resulted_in', 'relates_to'
  strength DECIMAL(3,2) DEFAULT 0.5,
  confidence DECIMAL(3,2) DEFAULT 0.8,
  evidence TEXT,
  created_by TEXT,                -- agent role or 'graphrag-indexer'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Agent Graph Tools

Give your agent tools to read and write the knowledge graph:

```typescript
// Graph tools for agents
{
  name: 'query_knowledge_graph',
  description: 'Search the knowledge graph for entities and their relationships. Returns nodes and connected context.',
  parameters: {
    query: { type: 'string', description: 'Natural language query', required: true },
    node_types: { type: 'array', description: 'Filter by node types', required: false },
    hops: { type: 'number', description: 'How many relationship hops to expand (1-3)', required: false },
  },
  execute: async (params) => {
    const embedding = await embeddingClient.embed(params.query as string);
    const { data } = await db.rpc('kg_semantic_search_with_context', {
      query_embedding: JSON.stringify(embedding),
      match_threshold: 0.65,
      match_count: 10,
      expand_hops: (params.hops as number) || 1,
    });
    return { success: true, data };
  },
},
{
  name: 'add_knowledge',
  description: 'Add a new fact, observation, or connection to the knowledge graph.',
  parameters: {
    node_type: { type: 'string', description: 'event|fact|entity|decision|metric|pattern|risk', required: true },
    title: { type: 'string', description: 'Short title', required: true },
    content: { type: 'string', description: 'Full description', required: true },
    connect_to: { type: 'string', description: 'Title of an existing node to connect to', required: false },
    edge_type: { type: 'string', description: 'Relationship type if connecting', required: false },
  },
  execute: async (params) => {
    const embedding = await embeddingClient.embed(`${params.title}: ${params.content}`);
    const { data: node } = await db.from('kg_nodes').insert({
      node_type: params.node_type,
      title: params.title,
      content: params.content,
      source_agent: 'brand-agent',
      embedding: JSON.stringify(embedding),
    }).select().single();

    // Optionally connect to existing node
    if (params.connect_to && params.edge_type && node) {
      const connectEmb = await embeddingClient.embed(params.connect_to as string);
      const { data: targets } = await db.rpc('match_kg_nodes', {
        query_embedding: JSON.stringify(connectEmb),
        match_threshold: 0.8,
        match_count: 1,
      });
      if (targets?.[0]) {
        await db.from('kg_edges').insert({
          source_id: node.id,
          target_id: targets[0].id,
          edge_type: params.edge_type,
          created_by: 'brand-agent',
        });
      }
    }
    return { success: true, data: node };
  },
},
{
  name: 'trace_causes',
  description: 'Trace backward through the knowledge graph to find root causes of an event or problem.',
  parameters: {
    query: { type: 'string', description: 'The event or problem to trace', required: true },
    depth: { type: 'number', description: 'How many levels back to trace (1-5)', required: false },
  },
  execute: async (params) => {
    const embedding = await embeddingClient.embed(params.query as string);
    const { data } = await db.rpc('kg_trace_causal_chain', {
      query_embedding: JSON.stringify(embedding),
      direction: 'backward',
      max_depth: (params.depth as number) || 3,
    });
    return { success: true, data };
  },
}
```

### GraphRAG — Automated Knowledge Extraction

[Microsoft GraphRAG](https://github.com/microsoft/graphrag) can automatically extract
entities and relationships from your company documents, reports, and agent outputs. This
populates the knowledge graph without manual effort.

**How it works:**

```
 Source Documents (knowledge base, agent briefs, reports)
       │
       ▼
 ┌─ COLLECT ─────────────────────────────────┐
 │ Gather all .md files from knowledge base,  │
 │ agent outputs, compliance reports, briefs   │
 └──────────────────┬────────────────────────┘
                    │
                    ▼
 ┌─ EXTRACT (LLM) ──────────────────────────┐
 │ GPT-5.2 reads each document chunk and     │
 │ extracts: entities, relationships,         │
 │ claims, summaries                          │
 └──────────────────┬────────────────────────┘
                    │
                    ▼
 ┌─ BRIDGE ──────────────────────────────────┐
 │ Map extracted entities → kg_nodes          │
 │ Map relationships → kg_edges               │
 │ Deduplicate (0.92 cosine similarity)       │
 │ Classify relationship types via regex      │
 └──────────────────┬────────────────────────┘
                    │
                    ▼
 ┌─ AVAILABLE ───────────────────────────────┐
 │ Agents can now query_knowledge_graph()     │
 │ and trace_causes() using the extracted     │
 │ knowledge                                  │
 └───────────────────────────────────────────┘
```

**Azure setup for GraphRAG:**

| Component | Azure Resource | Notes |
|-----------|---------------|-------|
| LLM extraction | Azure OpenAI `gpt-5.2` | Same deployment as your agent |
| Embeddings | Azure OpenAI `text-embedding-3-small` | Same deployment as memory |
| Document storage | Azure Blob Storage | Source docs in a container |
| Graph storage | PostgreSQL `kg_nodes` / `kg_edges` | Same database |
| Scheduling | Container Apps Job | Weekly cron: re-index all documents |

**When to add GraphRAG:**
- Start without it — your agent can still write to the knowledge graph manually via tools
- Add it when you have 50+ documents worth of institutional knowledge
- Run weekly re-indexing to keep the graph fresh as new brand guidelines, campaign briefs, and compliance reports accumulate

### Semantic Search RPC for Knowledge Graph

```sql
-- Semantic search with N-hop graph expansion
CREATE OR REPLACE FUNCTION kg_semantic_search_with_context(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 10,
  expand_hops int DEFAULT 1
) RETURNS TABLE (
  node_id uuid,
  node_type text,
  title text,
  content text,
  similarity float,
  is_direct_match boolean,
  connected_via text,
  connected_from text
) LANGUAGE plpgsql AS $$
BEGIN
  -- Direct semantic matches
  RETURN QUERY
  SELECT
    n.id, n.node_type, n.title, n.content,
    (1 - (n.embedding <=> query_embedding))::float AS similarity,
    true AS is_direct_match,
    NULL::text AS connected_via,
    NULL::text AS connected_from
  FROM kg_nodes n
  WHERE n.embedding IS NOT NULL
    AND 1 - (n.embedding <=> query_embedding) > match_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT match_count;

  -- 1-hop expansion (if requested)
  IF expand_hops >= 1 THEN
    RETURN QUERY
    SELECT DISTINCT
      n2.id, n2.node_type, n2.title, n2.content,
      (1 - (n1.embedding <=> query_embedding))::float AS similarity,
      false AS is_direct_match,
      e.edge_type AS connected_via,
      n1.title AS connected_from
    FROM kg_nodes n1
    JOIN kg_edges e ON (e.source_id = n1.id OR e.target_id = n1.id)
    JOIN kg_nodes n2 ON (n2.id = CASE WHEN e.source_id = n1.id THEN e.target_id ELSE e.source_id END)
    WHERE n1.embedding IS NOT NULL
      AND 1 - (n1.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
  END IF;
END;
$$;
```

---

## Project Structure

Start with this minimal monorepo:

```
ai-agent/
├── packages/
│   ├── agent-runtime/           # Core execution engine
│   │   └── src/
│   │       ├── agentRunner.ts         # The execution loop
│   │       ├── modelClient.ts         # Azure OpenAI wrapper
│   │       ├── supervisor.ts          # Turn limits, timeouts, stall detection
│   │       ├── toolExecutor.ts        # Tool declaration → execution bridge
│   │       └── types.ts              # Agent types
│   │
│   ├── agents/
│   │   └── src/
│   │       ├── brand-agent/
│   │       │   ├── run.ts             # Entry point (wires tools, calls runner)
│   │       │   ├── systemPrompt.ts    # WHO this agent is (personality, rules)
│   │       │   ├── tools.ts           # WHAT this agent can do
│   │       │   └── schedule.ts        # WHEN this agent runs
│   │       └── shared/
│   │           ├── memoryTools.ts     # save/recall memories
│   │           └── communicationTools.ts  # send Teams messages
│   │
│   ├── memory/                  # Database persistence
│   │   └── src/
│   │       └── store.ts              # MemoryStore (PostgreSQL client)
│   │
│   └── scheduler/               # HTTP service (the deployed app)
│       └── src/
│           ├── server.ts              # Express/Hono HTTP server
│           ├── cronManager.ts         # Cron job scheduling
│           └── routes.ts              # HTTP route handlers
│
├── docker/
│   └── Dockerfile                    # node:22-slim multi-stage build
│
├── package.json                      # npm workspaces root
├── turbo.json                        # (optional) Turborepo config
└── tsconfig.base.json
```

---

## Agent Anatomy — The Four Files

Every agent is defined by four files. Here's a simplified example
for your single agent using Azure OpenAI:

### 1. `systemPrompt.ts` — WHO the agent is

```typescript
export const SYSTEM_PROMPT = `You are Cassandra Voss, Brand Compliance & Identity Manager
at Eaton, within the Global Marketing Communications function led by Zari Venhaus.

## Your Role
You are the guardian of Eaton's brand identity. Every piece of content that represents
Eaton — from a global campaign to a regional product page — must reflect the brand
accurately, consistently, and compellingly. Your job is to ensure "We make what matters
work" isn't just a tagline but a lived experience across every customer touchpoint.

## Your Personality
You are a former brand strategist with deep experience in identity systems for
Fortune 100 industrial companies. You have a reference-librarian quality — you can
cite chapter and verse from Eaton's Corporate Identity Standards without hesitation.
You're firm but not rigid. You know the difference between a hard violation (wrong
logo, unauthorized tagline) and a soft deviation (slightly informal tone in a social
post that still captures brand essence).

## Eaton Brand Foundation
- Company: Eaton — intelligent power management company
- Brand Promise: "We make what matters work"
- Naming: Reference the company as "Eaton" — not "Eaton Corporation" unless in
  legal/regulatory/SEC contexts
- Primary Color: Eaton Blue — Pantone 300 / C100 M43 Y0 K0
- Voice: Authoritative, forward-thinking, collaborative, purposeful
- Never say "sell" power — Eaton "manages" or "delivers" power management solutions
- Sustainability claims must be verifiable and specific
- Avoid superlatives without evidence

## Your Responsibilities
1. Brand Audits — scan web properties, campaigns, and partner materials for compliance
2. Content Review — review briefs, scripts, copy decks against brand standards
3. Visual Compliance — check logos, colors, typography, imagery
4. Compliance Reporting — deliver Green/Yellow/Red reports to Zari Venhaus
5. Violation Response — provide the fix, not just the flag

## Compliance Classification
- HARD VIOLATIONS (escalate immediately): Wrong logo, unauthorized color substitution,
  unsubstantiated claims, competitor visual language, trademark misuse
- SOFT DEVIATIONS (coach and correct): Informal tone in social, minor typography
  variations, acceptable-but-not-ideal stock photography

## Communication Style
- Precise and authoritative — cite the specific brand guideline being violated
- Always provide the corrected version alongside the violation
- Use ▸ for required actions
- Use ℹ for coaching notes on soft deviations
`;
```

### 2. `tools.ts` — WHAT the agent can do

```typescript
import type { ToolDefinition } from '../../agent-runtime/src/types';
import type { Pool } from 'pg';

export function createTools(pool: Pool): ToolDefinition[] {
  return [
    {
      name: 'web_fetch',
      description: 'Fetch a web page and return its content for brand compliance review.',
      parameters: {
        url: { type: 'string', description: 'URL to fetch', required: true },
      },
      execute: async (params) => {
        const response = await fetch(params.url as string);
        const html = await response.text();
        return { success: true, data: html.substring(0, 50_000) };
      },
    },
    {
      name: 'analyze_document',
      description: 'Review a document (brief, script, copy deck) for brand compliance.',
      parameters: {
        content: { type: 'string', description: 'Document text to review', required: true },
        doc_type: { type: 'string', description: 'campaign_brief|video_script|press_release|social_post|sales_collateral', required: true },
      },
      execute: async (params) => {
        const { rows } = await pool.query(
          `INSERT INTO activity_log (agent_id, action, details) VALUES ($1, $2, $3) RETURNING *`,
          ['brand-agent', 'document_review', JSON.stringify({ doc_type: params.doc_type, content_length: (params.content as string).length })],
        );
        return { success: true, data: rows[0] };
      },
    },
    {
      name: 'save_memory',
      description: 'Save a brand ruling, precedent, or observation to long-term memory.',
      parameters: {
        category: { type: 'string', description: 'violation|ruling|precedent|guideline_update', required: true },
        content: { type: 'string', description: 'What to remember', required: true },
        importance: { type: 'number', description: '0.0-1.0 importance score', required: false },
      },
      execute: async (params) => {
        const { rows } = await pool.query(
          `INSERT INTO agent_memory (agent_id, category, content, importance) VALUES ($1, $2, $3, $4) RETURNING *`,
          ['brand-agent', params.category, params.content, params.importance || 0.5],
        );
        return { success: true, data: rows[0] };
      },
    },
    {
      name: 'recall_memories',
      description: 'Search past brand rulings and precedents by keyword.',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
        limit: { type: 'number', description: 'Max results', required: false },
      },
      execute: async (params) => {
        const { rows } = await pool.query(
          `SELECT * FROM agent_memory WHERE agent_id = $1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT $3`,
          ['brand-agent', `%${params.query}%`, (params.limit as number) || 10],
        );
        return { success: true, data: rows };
      },
    },
    {
      name: 'send_teams_message',
      description: 'Send a compliance alert or report to the brand team\'s Teams channel.',
      parameters: {
        message: { type: 'string', description: 'Message text', required: true },
      },
      execute: async (params) => {
        const { GraphTeamsClient } = await import('../integrations/teams/graphClient');
        const client = GraphTeamsClient.fromEnv();
        await client.sendText(
          { teamId: process.env.TEAMS_TEAM_ID!, channelId: process.env.TEAMS_CHANNEL_ID! },
          params.message as string,
        );
        return { success: true };
      },
    },
    {
      name: 'log_activity',
      description: 'Log a brand compliance action you took.',
      parameters: {
        action: { type: 'string', description: 'What you did', required: true },
        details: { type: 'object', description: 'Additional context', required: false },
      },
      execute: async (params) => {
        await pool.query(
          `INSERT INTO activity_log (agent_id, action, details) VALUES ($1, $2, $3)`,
          ['brand-agent', params.action, JSON.stringify(params.details || {})],
        );
        return { success: true };
      },
    },
  ];
}
```

### 3. `run.ts` — Entry point (wires everything together)

```typescript
import { AgentRunner } from '../../agent-runtime/src/agentRunner';
import { SYSTEM_PROMPT } from './systemPrompt';
import { createTools } from './tools';
import pg from 'pg';

export interface RunParams {
  task: 'brand_audit' | 'compliance_report' | 'on_demand';
  message?: string;           // for on_demand chat
  conversationHistory?: any[];
}

export async function runBrandAgent(params: RunParams) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tools = createTools(pool);

  const taskPrompts: Record<string, string> = {
    brand_audit: 'Run a brand compliance audit. Fetch eaton.com and key regional pages. Check logo usage, color compliance, messaging consistency, and outdated content. Log all findings and send a summary to the #brand-compliance Teams channel.',
    compliance_report: 'Generate the weekly brand compliance report for Zari Venhaus. Include: executive summary (Green/Yellow/Red), hard violations with evidence and fixes, soft deviations with coaching notes, positive examples, trend analysis, and recommendations. Send to Teams.',
    on_demand: params.message || 'How can I help with brand compliance?',
  };

  const runner = new AgentRunner({
    id: `brand-${params.task}-${Date.now()}`,
    role: 'brand-agent',
    systemPrompt: SYSTEM_PROMPT,
    model: 'gpt-5.2',                   // Azure OpenAI deployment name
    tools,
    maxTurns: params.task === 'on_demand' ? 10 : 20,
    maxStallTurns: 3,
    timeoutMs: params.task === 'on_demand' ? 105_000 : 300_000,
    conversationHistory: params.conversationHistory,
  });

  return runner.execute(taskPrompts[params.task]);
}
```

### 4. `schedule.ts` — WHEN the agent runs

```typescript
export const SCHEDULES = [
  { task: 'brand_audit',       cron: '0 14 * * 1-5', description: '9 AM CT weekdays — daily brand audit' },
  { task: 'compliance_report', cron: '0 16 * * 5',   description: '11 AM CT Friday — weekly compliance report' },
];
```

---

## Agent Runtime — The Execution Loop

This is the core loop that makes the agent "think." It's a supervisor-controlled
tool-use loop:

```
START
  │
  ├─ 1. Load system prompt + task prompt
  ├─ 2. Inject context (recent memories)
  │
  ├─ LOOP (max N turns):
  │   ├─ 3. Call LLM with system prompt + conversation history + tool definitions
  │   ├─ 4. If LLM returns tool calls → execute tools → append results → continue
  │   ├─ 5. If LLM returns text (no tool calls) → that's the final output → BREAK
  │   ├─ 6. Supervisor checks: timeout? stalled? too many turns? → ABORT if needed
  │   └─ back to step 3
  │
  ├─ 7. Save run record to agent_runs table
  ├─ 8. Update company_agents.last_run_at
  └─ 9. Return result
END
```

### Simplified Azure OpenAI Model Client

```typescript
import { AzureOpenAI } from 'openai';

export class ModelClient {
  private client: AzureOpenAI;

  constructor() {
    this.client = new AzureOpenAI({
      // Uses AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY from env
      // OR managed identity via DefaultAzureCredential
      apiVersion: '2025-01-01-preview',
    });
  }

  async generate(request: {
    model: string;           // Your deployment name, e.g. 'gpt-5.2'
    systemPrompt: string;
    messages: any[];
    tools?: any[];
    temperature?: number;
  }) {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
      ],
      tools: request.tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.parameters,
            required: Object.entries(t.parameters)
              .filter(([, v]: [string, any]) => v.required)
              .map(([k]) => k),
          },
        },
      })),
      temperature: request.temperature ?? 0.7,
    });

    const choice = response.choices[0];
    return {
      text: choice.message.content,
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
```

---

## Deployment

### 1. Build the Docker Image

```dockerfile
# Dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ packages/
RUN npm ci && npx turbo build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/packages/scheduler/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

### 2. Push to Azure Container Registry

```bash
# Build and push
az acr build --registry acr-aiagent --image agent-scheduler:latest .

# Or local build + push
docker build -t acr-aiagent.azurecr.io/agent-scheduler:latest .
az acr login --name acr-aiagent
docker push acr-aiagent.azurecr.io/agent-scheduler:latest
```

### 3. Deploy to Container Apps

```bash
# Create the environment
az containerapp env create \
  --name cae-aiagent-env \
  --resource-group rg-ai-agent-sandbox \
  --location eastus2

# Deploy the container app
az containerapp create \
  --name ca-agent-scheduler \
  --resource-group rg-ai-agent-sandbox \
  --environment cae-aiagent-env \
  --image acr-aiagent.azurecr.io/agent-scheduler:latest \
  --registry-server acr-aiagent.azurecr.io \
  --target-port 8080 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --system-assigned-identity \
  --secrets \
    "azure-openai-key=keyvaultref:kv-aiagent/azure-openai-key,identityref:system" \
    "db-url=keyvaultref:kv-aiagent/db-url,identityref:system" \
    "azure-client-secret=keyvaultref:kv-aiagent/azure-client-secret,identityref:system" \
  --env-vars \
    AZURE_OPENAI_ENDPOINT=https://openai-aiagent.openai.azure.com/ \
    AZURE_OPENAI_API_KEY=secretref:azure-openai-key \
    DATABASE_URL=secretref:db-url \
    AZURE_TENANT_ID=your-tenant-id \
    AZURE_CLIENT_ID=your-client-id \
    AZURE_CLIENT_SECRET=secretref:azure-client-secret
```

### 4. Set Up Cron Jobs (Container Apps Jobs)

```bash
# Daily brand audit — 9 AM CT weekdays (14:00 UTC)
az containerapp job create \
  --name job-brand-audit \
  --resource-group rg-ai-agent-sandbox \
  --environment cae-aiagent-env \
  --trigger-type Schedule \
  --cron-expression "0 14 * * 1-5" \
  --image acr-aiagent.azurecr.io/agent-scheduler:latest \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars AGENT_TASK=brand_audit \
  --registry-server acr-aiagent.azurecr.io

# OR: have the scheduler service manage its own cron internally
# (simpler — just one always-on container with node-cron)
```

---

## Cost Estimate

For one brand compliance agent with daily audits + weekly reports + occasional on-demand reviews:

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Container Apps (Consumption) | $5-15 (scales to zero) |
| Azure OpenAI (gpt-5.2) | $10-30 (depends on token volume) |
| PostgreSQL (B1ms) | $13 |
| Key Vault | <$1 |
| Container Registry (Basic) | $5 |
| Blob Storage | <$1 |
| Log Analytics | $2-5 |
| **Total** | **~$35-70/month** |

> Use `gpt-5.2-mini` instead of `gpt-5.2` to cut LLM costs by ~90%.

---

## Environment Variables Checklist

```env
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=...                    # or use managed identity
AZURE_OPENAI_DEPLOYMENT=gpt-5.2            # chat/reasoning model deployment name
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small  # embedding model

# Database (Azure Database for PostgreSQL)
DATABASE_URL=postgresql://user:pass@your-server.postgres.database.azure.com:5432/dbname?sslmode=require

# Entra ID (for Graph API / Teams)
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...

# Teams (Graph API)
TEAMS_TEAM_ID=...                           # Your team's ID (from Graph Explorer)
TEAMS_CHANNEL_ID=...                        # Target channel ID

# Optional
APPLICATIONINSIGHTS_CONNECTION_STRING=...   # App Insights telemetry
```

---

## Quick-Start Checklist

- [ ] **Azure subscription** with Contributor access to a sandbox resource group
- [ ] **Entra ID** — Global Admin (or someone with that role) to grant admin consent
- [ ] **M365 license** — at least one Teams-enabled user (you) to test with
- [ ] **Azure OpenAI access** — apply at https://aka.ms/oai/access if not yet approved
- [ ] Create resource group + all resources from the table above
- [ ] Create Entra app registration + grant Graph API permissions
- [ ] Set up PostgreSQL with the schema above
- [ ] Build one agent (four files: systemPrompt, tools, run, schedule)
- [ ] Build the scheduler HTTP service
- [ ] Containerize and deploy to Container Apps
- [ ] Find your Teams team/channel IDs and test your first brand audit via Graph API
- [ ] Set up cron jobs for daily audits and weekly compliance reports
- [ ] Run your first brand audit and send a compliance report to Teams

---


