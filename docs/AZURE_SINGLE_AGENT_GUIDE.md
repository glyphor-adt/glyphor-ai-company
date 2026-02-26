# Building a Single AI Executive Agent on Azure

> A peer-ready guide for deploying one autonomous AI persona into an enterprise Azure environment.
> Based on the Glyphor AI Company architecture — simplified to one agent, zero voice, Azure-native.

---

## Table of Contents

1. [What You're Building](#what-youre-building)
2. [Azure Resources Required](#azure-resources-required)
3. [Entra ID & Permissions](#entra-id--permissions)
4. [Microsoft 365 & Teams Setup](#microsoft-365--teams-setup)
5. [Database Schema (Minimal)](#database-schema-minimal)
6. [Project Structure](#project-structure)
7. [Agent Anatomy — The Four Files](#agent-anatomy--the-four-files)
8. [Agent Runtime — The Execution Loop](#agent-runtime--the-execution-loop)
9. [Authority Model](#authority-model)
10. [Deployment](#deployment)
11. [Cost Estimate](#cost-estimate)
12. [Scaling to Multiple Agents](#scaling-to-multiple-agents)

---

## What You're Building

A single AI agent persona (e.g., "Chief of Staff") that:

- **Runs on a schedule** — cron-triggered tasks (morning briefing, end-of-day summary)
- **Responds on demand** — chat via a web dashboard or Teams DM
- **Persists memory** — remembers past interactions, decisions, and context
- **Posts to Teams** — sends briefings, decision requests, and alerts to channels
- **Uses an authority model** — some actions are autonomous, others require human approval
- **Calls LLMs** — Azure OpenAI (GPT-4o / o4-mini) for reasoning
- **Has tools** — can read/write to a database, search the web, send messages

This is NOT a chatbot. It's an autonomous agent with a persistent identity, memory, scheduled
work cycles, and the ability to take actions in your enterprise environment.

---

## Azure Resources Required

### Core (Must-Have)

| Resource | SKU / Tier | Purpose |
|----------|-----------|---------|
| **Azure Container Apps** | Consumption plan | Hosts the agent scheduler service (the "brain"). Scales to zero when idle, wakes on cron/HTTP. Replaces GCP Cloud Run. |
| **Azure OpenAI Service** | S0 (Standard) | LLM inference. Deploy `gpt-4o` for quality or `gpt-4o-mini` for cost. This is your agent's "thinking" engine. |
| **Azure Database for PostgreSQL** | Flexible Server, Burstable B1ms | Agent memory, decisions, activity log, agent config. ~15 core tables. Enable `pgvector` extension for embeddings. |
| **Azure Key Vault** | Standard | Store all secrets: API keys, DB connection strings, Entra app credentials. Never hardcode. |
| **Azure Container Registry** | Basic | Store your Docker images. |
| **Entra ID App Registration** | Free (included with M365) | Service principal for Graph API (Teams, email). |

### Supporting (Recommended)

| Resource | SKU / Tier | Purpose |
|----------|-----------|---------|
| **Azure Blob Storage** | Standard LRS, Hot tier | Archive briefings, reports, large documents. |
| **Azure Log Analytics** | Pay-per-GB | Centralized logging for agent runs, errors, LLM costs. |
| **Azure Application Insights** | (auto-created with Log Analytics) | Request tracing, performance monitoring. |
| **Azure Static Web Apps** | Free tier | Host the dashboard UI (React SPA). |

### NOT Needed for v1

| Resource | Why Not |
|----------|---------|
| Azure AI Search | Only needed if you add GraphRAG/knowledge graph later |
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
├── psql-aiagent                   # PostgreSQL Flexible Server
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
| `Storage Blob Data Contributor` | Storage account | Read/write briefing archives |
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

## Microsoft 365 & Teams Setup

### Phase 1: Incoming Webhooks (Start Here — No Admin Needed)

The fastest way to get your agent posting to Teams:

1. In a Teams channel, click `...` → Connectors → Incoming Webhook
2. Name it after your agent (e.g., "Sarah - Chief of Staff")
3. Save the webhook URL in Key Vault as `TEAMS-WEBHOOK-URL`
4. Your agent POSTs adaptive cards to this URL — no Graph API needed

```typescript
// Simplest Teams integration — just HTTP POST
async function sendToTeams(webhookUrl: string, card: object) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      }],
    }),
  });
}
```

### Phase 2: Bot Framework (For DMs & Interactive Cards)

When you want the agent to receive messages (not just send):

1. Go to https://dev.botframework.com → Create a bot
2. Use the Entra app registration from above
3. Set messaging endpoint: `https://your-container-app-url/api/teams/messages`
4. Enable the Teams channel
5. Create a Teams app manifest:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
  "manifestVersion": "1.17",
  "version": "1.0.0",
  "id": "{{BOT_APP_ID}}",
  "name": { "short": "AI Chief of Staff" },
  "description": { "short": "Your AI Chief of Staff agent" },
  "bots": [{
    "botId": "{{BOT_APP_ID}}",
    "scopes": ["personal", "team"],
    "commandLists": [{
      "scopes": ["personal"],
      "commands": [
        { "title": "briefing", "description": "Get your morning briefing" },
        { "title": "status", "description": "Company status check" }
      ]
    }]
  }]
}
```

6. Upload to Teams Admin Center → Manage apps → Upload custom app

### Phase 3: Agent Email (Optional)

For enterprise agents that need to send/receive email:

1. M365 Admin → Shared mailboxes → Create: `chief-of-staff@yourdomain.com`
2. Grant the Entra app registration `Mail.Send` + `Mail.Read` (application permission)
3. Scope with an Application Access Policy if you want to limit which mailboxes the app can access

---

## Database Schema (Minimal)

These are the essential tables for a single-agent system. In Glyphor we have 73 tables; you
need about 15 to start.

```sql
-- Enable pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Agent roster (even for one agent, this is the source of truth)
CREATE TABLE company_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT UNIQUE NOT NULL,            -- 'chief-of-staff'
  display_name TEXT NOT NULL,           -- 'Sarah Chen'
  model TEXT NOT NULL,                  -- 'gpt-4o'
  status TEXT DEFAULT 'active',         -- active | paused | retired
  schedule_cron TEXT,                   -- '0 12 * * *' (UTC)
  last_run_at TIMESTAMPTZ,
  total_runs INT DEFAULT 0,
  total_cost_usd DECIMAL(10,2) DEFAULT 0,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Agent run history (every execution is tracked)
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,               -- 'chief-of-staff'
  task TEXT NOT NULL,                    -- 'morning_briefing', 'on_demand', 'orchestrate'
  status TEXT DEFAULT 'running',        -- running | completed | failed | aborted
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  model_used TEXT,
  input_tokens INT,
  output_tokens INT,
  cost_usd DECIMAL(10,6),
  turns_used INT,
  result TEXT,                          -- summary of what the agent did
  error TEXT                            -- error message if failed
);

-- 3. Agent memory (long-term, vector-searchable)
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,               -- 'observation', 'decision', 'learning', 'preference'
  content TEXT NOT NULL,
  importance DECIMAL(3,2) DEFAULT 0.5,  -- 0.0-1.0
  embedding vector(1536),              -- text-embedding-3-small (Azure OpenAI)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ               -- optional TTL
);
CREATE INDEX idx_memory_embedding ON agent_memory USING ivfflat (embedding vector_cosine_ops);

-- 4. Decision queue (authority model)
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL,                   -- 'green', 'yellow', 'red'
  status TEXT DEFAULT 'pending',        -- pending | approved | rejected
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  proposed_by TEXT NOT NULL,            -- agent role
  assigned_to TEXT[],                   -- human approver(s)
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 5. Activity log (what the agent actually did)
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,                 -- 'compiled_briefing', 'sent_teams_message'
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Founder directives (marching orders)
CREATE TABLE founder_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',       -- low | medium | high | critical
  status TEXT DEFAULT 'active',         -- active | completed | cancelled
  created_by TEXT NOT NULL,             -- 'kristina', 'andrew', etc.
  progress_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 7. Work assignments (orchestrator → agent task dispatch)
CREATE TABLE work_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID REFERENCES founder_directives(id),
  assigned_to TEXT NOT NULL,
  task_description TEXT NOT NULL,
  expected_output TEXT,
  status TEXT DEFAULT 'assigned',       -- assigned | in_progress | completed | blocked
  priority TEXT DEFAULT 'medium',
  output TEXT,
  quality_score DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 8. Chat messages (dashboard conversation history)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'user' | 'assistant'
  content TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Company knowledge base (shared context)
CREATE TABLE company_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,               -- 'product', 'process', 'policy', 'metric'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Agent schedules (cron definitions, DB-driven)
CREATE TABLE agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  task TEXT NOT NULL,
  cron_expression TEXT NOT NULL,        -- e.g. '0 12 * * *'
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed your agent
INSERT INTO company_agents (role, display_name, model, status, schedule_cron)
VALUES ('chief-of-staff', 'Sarah Chen', 'gpt-4o', 'active', '0 12 * * *');

-- Seed schedules
INSERT INTO agent_schedules (agent_id, task, cron_expression) VALUES
  ('chief-of-staff', 'morning_briefing', '0 12 * * *'),   -- 7 AM CT
  ('chief-of-staff', 'eod_summary',      '0 23 * * *'),   -- 6 PM CT
  ('chief-of-staff', 'orchestrate',      '0 * * * *');     -- hourly
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
│   │       ├── chief-of-staff/
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
│   │       └── store.ts              # MemoryStore (Supabase/PostgreSQL client)
│   │
│   └── scheduler/               # HTTP service (the deployed app)
│       └── src/
│           ├── server.ts              # Express/Hono HTTP server
│           ├── cronManager.ts         # Cron job scheduling
│           ├── authorityGates.ts      # Green/Yellow/Red classification
│           └── decisionQueue.ts       # Human approval workflow
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

Every agent in the Glyphor system is defined by four files. Here's a simplified example
for your single agent using Azure OpenAI:

### 1. `systemPrompt.ts` — WHO the agent is

```typescript
export const SYSTEM_PROMPT = `You are Sarah Chen, the Chief of Staff at [YOUR COMPANY].

## Your Role
You are the operational backbone. You bridge the AI executive team and the human leadership.

## Your Personality
You are warm but efficient. You use "we" language. You're the glue — you remember
everyone's context and connect the dots nobody else sees.

## Your Responsibilities
1. Morning Briefings — concise, actionable, tailored to each leader
2. Decision Routing — Green (auto) / Yellow (one approver) / Red (both approve)
3. Activity Synthesis — aggregate activity into coherent summaries
4. Directive Execution — translate high-level directives into work assignments

## Communication Style
- Warm but efficient — lead with what matters
- Numbers before narratives
- Flag risks prominently
- Use ▸ for action items

## Authority Level
- GREEN: Compile briefings, route decisions, log activities, synthesize reports
- YELLOW: Cannot approve — only route to leadership
- RED: Cannot approve — must flag all designated approvers
`;
```

### 2. `tools.ts` — WHAT the agent can do

```typescript
import type { ToolDefinition } from '../../agent-runtime/src/types';

export function createTools(db: any): ToolDefinition[] {
  return [
    {
      name: 'get_recent_activity',
      description: 'Get recent activity from the last N hours.',
      parameters: {
        hours: { type: 'number', description: 'Hours to look back', required: false },
      },
      execute: async (params) => {
        const hours = (params.hours as number) || 24;
        const { data } = await db
          .from('activity_log')
          .select('*')
          .gte('created_at', new Date(Date.now() - hours * 3600000).toISOString())
          .order('created_at', { ascending: false });
        return { success: true, data };
      },
    },
    {
      name: 'save_memory',
      description: 'Save an observation or learning to long-term memory.',
      parameters: {
        category: { type: 'string', description: 'observation|decision|learning', required: true },
        content: { type: 'string', description: 'What to remember', required: true },
        importance: { type: 'number', description: '0.0-1.0 importance score', required: false },
      },
      execute: async (params) => {
        const { data } = await db.from('agent_memory').insert({
          agent_id: 'chief-of-staff',
          category: params.category,
          content: params.content,
          importance: params.importance || 0.5,
        }).select();
        return { success: true, data };
      },
    },
    {
      name: 'recall_memories',
      description: 'Search past memories by keyword.',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
        limit: { type: 'number', description: 'Max results', required: false },
      },
      execute: async (params) => {
        const { data } = await db
          .from('agent_memory')
          .select('*')
          .eq('agent_id', 'chief-of-staff')
          .textSearch('content', params.query as string)
          .limit((params.limit as number) || 10);
        return { success: true, data };
      },
    },
    {
      name: 'send_teams_message',
      description: 'Send a message or adaptive card to a Teams channel.',
      parameters: {
        channel: { type: 'string', description: 'Channel name', required: true },
        message: { type: 'string', description: 'Message text or card JSON', required: true },
      },
      execute: async (params) => {
        // Uses webhook URL from Key Vault
        const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
        if (!webhookUrl) return { success: false, error: 'No webhook configured' };
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: params.message }),
        });
        return { success: true };
      },
    },
    {
      name: 'submit_decision',
      description: 'Submit a decision to the approval queue.',
      parameters: {
        tier: { type: 'string', description: 'green|yellow|red', required: true },
        title: { type: 'string', description: 'Decision title', required: true },
        summary: { type: 'string', description: 'What needs deciding', required: true },
      },
      execute: async (params) => {
        const { data } = await db.from('decisions').insert({
          tier: params.tier,
          title: params.title,
          summary: params.summary,
          proposed_by: 'chief-of-staff',
          assigned_to: params.tier === 'red' ? ['leader1', 'leader2'] : ['leader1'],
        }).select();
        return { success: true, data };
      },
    },
    {
      name: 'read_directives',
      description: 'Read active founder directives.',
      parameters: {},
      execute: async () => {
        const { data } = await db
          .from('founder_directives')
          .select('*')
          .eq('status', 'active')
          .order('priority', { ascending: false });
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an action you took.',
      parameters: {
        action: { type: 'string', description: 'What you did', required: true },
        details: { type: 'object', description: 'Additional context', required: false },
      },
      execute: async (params) => {
        await db.from('activity_log').insert({
          agent_id: 'chief-of-staff',
          action: params.action,
          details: params.details || {},
        });
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
import { createClient } from '@supabase/supabase-js';

export interface RunParams {
  task: 'morning_briefing' | 'eod_summary' | 'orchestrate' | 'on_demand';
  message?: string;           // for on_demand chat
  conversationHistory?: any[];
}

export async function runChiefOfStaff(params: RunParams) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const tools = createTools(db);

  const taskPrompts: Record<string, string> = {
    morning_briefing: 'Generate the morning briefing. Read recent activity, metrics, and pending decisions. Send to the #briefings Teams channel.',
    eod_summary: 'Generate the end-of-day summary. What happened today? What needs attention tomorrow?',
    orchestrate: 'Check for active directives. Plan and dispatch work. Track progress on in-flight tasks.',
    on_demand: params.message || 'How can I help?',
  };

  const runner = new AgentRunner({
    id: `cos-${params.task}-${Date.now()}`,
    role: 'chief-of-staff',
    systemPrompt: SYSTEM_PROMPT,
    model: 'gpt-4o',                    // Azure OpenAI deployment name
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
  { task: 'morning_briefing', cron: '0 12 * * *', description: '7 AM CT — morning briefing' },
  { task: 'eod_summary',      cron: '0 23 * * *', description: '6 PM CT — end of day' },
  { task: 'orchestrate',      cron: '0 * * * *',   description: 'Every hour — directive sweep' },
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
  ├─ 2. Inject context (recent memories, active directives, pending decisions)
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
    model: string;           // Your deployment name, e.g. 'gpt-4o'
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

## Authority Model

Every action the agent wants to take is classified:

| Tier | What Happens | Enterprise Example |
|------|-------------|-------------------|
| **Green** | Agent executes immediately. Logged but no approval needed. | Compile briefing, read metrics, save memory, log activity |
| **Yellow** | Agent submits to decision queue. One designated approver. | Send external email, modify a work assignment, escalate an issue |
| **Red** | Both/all designated approvers must approve. | Change agent configuration, create new agent, modify access |

```typescript
// authorityGates.ts — simplified
const GREEN_ACTIONS: Record<string, string[]> = {
  'chief-of-staff': [
    'compile_briefing', 'route_decision', 'log_activity',
    'synthesize_report', 'generate_briefing', 'morning_briefing',
    'eod_summary', 'on_demand',
  ],
};

export function checkAuthority(role: string, action: string): 'green' | 'yellow' | 'red' {
  if (GREEN_ACTIONS[role]?.includes(action)) return 'green';
  // Default unknown actions to yellow (safe default)
  return 'yellow';
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
# Morning briefing — 7 AM CT (12:00 UTC)
az containerapp job create \
  --name job-morning-briefing \
  --resource-group rg-ai-agent-sandbox \
  --environment cae-aiagent-env \
  --trigger-type Schedule \
  --cron-expression "0 12 * * *" \
  --image acr-aiagent.azurecr.io/agent-scheduler:latest \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars AGENT_TASK=morning_briefing \
  --registry-server acr-aiagent.azurecr.io

# OR: have the scheduler service manage its own cron internally
# (simpler — just one always-on container with node-cron)
```

---

## Cost Estimate

For one agent with 3-5 daily scheduled runs + occasional on-demand chat:

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Container Apps (Consumption) | $5-15 (scales to zero) |
| Azure OpenAI (gpt-4o) | $10-30 (depends on token volume) |
| PostgreSQL (B1ms) | $13 |
| Key Vault | <$1 |
| Container Registry (Basic) | $5 |
| Blob Storage | <$1 |
| Log Analytics | $2-5 |
| **Total** | **~$35-70/month** |

> Use `gpt-4o-mini` instead of `gpt-4o` to cut LLM costs by ~90%.

---

## Scaling to Multiple Agents

Once your single agent is working, the architecture scales naturally:

1. **Add a persona** — Copy the `chief-of-staff/` folder, write new `systemPrompt.ts` and `tools.ts`
2. **Register it** — INSERT into `company_agents` + `agent_schedules`
3. **Add inter-agent communication** — agents can write messages to each other via the `agent_messages` table
4. **Add orchestration** — your CoS agent can dispatch work to other agents via `work_assignments`
5. **Add more tools** — each agent gets role-specific tools (CFO gets financial tools, CTO gets infra tools)
6. **Add the knowledge graph** — introduce `kg_nodes` / `kg_edges` tables for shared knowledge

The Glyphor system runs 34 agents on this exact pattern. The jump from 1 to N is
mostly configuration, not new architecture.

---

## Environment Variables Checklist

```env
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=...                    # or use managed identity

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
# OR Supabase-style:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=...

# Entra ID (for Graph API / Teams)
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...

# Teams (Phase 1 — webhooks)
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...

# Optional
TEAMS_TEAM_ID=...                           # For Graph API channel messaging
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
- [ ] Set up a Teams incoming webhook and test your first briefing
- [ ] Set up cron jobs for scheduled tasks
- [ ] Send your first morning briefing to Teams

---

## Key Differences from Glyphor (GCP → Azure)

| Glyphor (GCP) | Your Setup (Azure) | Notes |
|---|---|---|
| GCP Cloud Run | Azure Container Apps | Same scale-to-zero model |
| GCP Cloud Scheduler + Pub/Sub | Container Apps Jobs or node-cron | Jobs are simpler for small scale |
| Gemini 3 Flash | Azure OpenAI GPT-4o / 4o-mini | Swap model name in config |
| Supabase (hosted PostgreSQL) | Azure Database for PostgreSQL | Same PostgreSQL, just Azure-hosted |
| GCS (Cloud Storage) | Azure Blob Storage | Same concept, different SDK |
| Google Gemini embeddings | Azure OpenAI text-embedding-3-small | 1536-dim instead of 768-dim |
| GCP Artifact Registry | Azure Container Registry | Same role |
| Entra ID (same) | Entra ID (same) | Already Azure-native in Glyphor |
| GitHub Actions | GitHub Actions (same) or Azure DevOps | CI/CD is provider-agnostic |
