# Build Your Own AI Agent on Microsoft (Enterprise Guide)

> How to build and deploy an autonomous agent in your enterprise, running entirely on Azure and Microsoft 365. 

## Table of Contents

- [Prerequisites](#prerequisites)
- [Phase 1 — Azure Infrastructure](#phase-1--azure-infrastructure)
- [Phase 2 — LLM Access (Azure OpenAI)](#phase-2--llm-access-azure-openai)
- [Phase 3 — Entra ID Agent Identity](#phase-3--entra-id-agent-identity)
- [Phase 4 — Write the Agent Code](#phase-4--write-the-agent-code)
- [Phase 5 — Agent365 Environment & Wiring](#phase-5--agent365-environment--wiring)
- [Phase 6 — Scheduler & Hosting](#phase-6--scheduler--hosting)
- [Phase 7 — Teams Integration](#phase-7--teams-integration)
- [Phase 8 — Validate](#phase-8--validate)
- [Architecture Summary](#architecture-summary)
- [Files Per Agent Summary](#files-per-agent-summary)
- [What You Get](#what-you-get)

---

## Prerequisites

Before writing any code:

- [ ] An **Azure subscription** with Owner or Contributor access
- [ ] An **Entra ID tenant** (your Microsoft 365 tenant)
- [ ] **Global Admin** or **Application Administrator** role in Entra ID
- [ ] **Exchange Online** admin access (for mailbox creation)
- [ ] **Microsoft Teams** with a team and channels set up
- [ ] **Node.js 20+** and **TypeScript**
- [ ] **Azure CLI** (`az`) and **Microsoft Graph PowerShell** (`Install-Module Microsoft.Graph`)

---

## Agent Identity Card

Before touching code, fill this out for your agent:

```
Role slug:        _______________  (e.g. 'legal-analyst')
Full name:        _______________  (e.g. 'Victoria Chase')
Job title:        _______________  (e.g. 'Chief Legal Officer')
Department:       _______________  (e.g. 'Legal')
Reports to:       _______________  (e.g. null for exec, 'cto' for sub-team)
Tier:             _______________  (Executive / Sub-Team / Specialist)
Email:            _______________@yourdomain.com
Entra app roles:  _______________  (e.g. YourOrg.Legal.Read)
Model:            _______________  (e.g. gpt-4o via Azure OpenAI)
Budget (per-run): $_______________
Budget (daily):   $_______________
Budget (monthly): $_______________
```

---

## Phase 1 — Azure Infrastructure

Set up the cloud backbone. 

### Step 1: Create a Resource Group

```bash
az group create --name rg-agents --location eastus2
```

### Step 2: Create Azure Database for PostgreSQL (Flexible Server)

This holds agent state, decisions, activity logs, memory, and profiles.

```bash
az postgres flexible-server create \
  --resource-group rg-agents \
  --name agents-db \
  --admin-user agentsadmin \
  --admin-password '<strong-password>' \
  --sku-name Standard_B2ms \
  --tier Burstable \
  --version 16 \
  --public-access 0.0.0.0
```

Create the database and apply the schema:

```bash
az postgres flexible-server db create \
  --resource-group rg-agents \
  --server-name agents-db \
  --database-name agents

psql "host=agents-db.postgres.database.azure.com dbname=agents user=agentsadmin" \
  -f db/migrations/20260222030000_create_tables.sql
```

Core tables:

| Table | Purpose |
|-------|---------|
| `company_agents` | Agent roster — role, model, status, budget |
| `agent_profiles` | Soul — personality, backstory, quirks, voice, Clifton strengths |
| `decisions` | Decision queue (GREEN/YELLOW/RED tiers) |
| `activity_log` | Audit trail of all agent actions |
| `agent_memory` | Long-term memory per agent |
| `agent_memory_reflections` | Distilled insights from memory |
| `agent_runs` | Execution logs per run |
| `agent_schedules` | Cron schedules for recurring tasks |
| `work_assignments` | Task routing between agents |

### Step 3: Create Azure Blob Storage

Used for large documents, reports, and artifacts.

```bash
az storage account create \
  --resource-group rg-agents \
  --name agentsblob \
  --sku Standard_LRS

az storage container create \
  --account-name agentsblob \
  --name agent-artifacts
```

### Step 4: Create Azure Key Vault

Store all secrets here.

```bash
az keyvault create \
  --resource-group rg-agents \
  --name agents-kv

az keyvault secret set --vault-name agents-kv --name "db-password" --value "<password>"
az keyvault secret set --vault-name agents-kv --name "agent365-client-secret" --value "<secret>"
az keyvault secret set --vault-name agents-kv --name "azure-openai-key" --value "<key>"
```

### Step 5: Create Azure Container Registry

```bash
az acr create \
  --resource-group rg-agents \
  --name agentscr \
  --sku Basic
```

### Step 6: Create Azure Container Apps Environment

This is where your agent scheduler runs.

```bash
az containerapp env create \
  --resource-group rg-agents \
  --name agents-env \
  --location eastus2
```

---

## Phase 2 — LLM Access (Azure OpenAI)

### Step 7: Create Azure OpenAI Resource and Deploy a Model

```bash
az cognitiveservices account create \
  --resource-group rg-agents \
  --name agents-openai \
  --kind OpenAI \
  --sku S0 \
  --location eastus2

az cognitiveservices account deployment create \
  --resource-group rg-agents \
  --name agents-openai \
  --deployment-name gpt-4o \
  --model-name gpt-4o \
  --model-version "2024-08-06" \
  --model-format OpenAI \
  --sku-name Standard \
  --sku-capacity 30
```

The `ModelClient` in the codebase already supports `gpt-*` and `o*` model prefixes. Point it at your Azure OpenAI endpoint:

```env
AZURE_OPENAI_ENDPOINT=https://agents-openai.openai.azure.com
AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_API_VERSION=2024-08-06
```

---

## Phase 3 — Entra ID Agent Identity

Every agent is a first-class identity in your Entra tenant. This is the core differentiator — your agent has an email, a calendar, a Teams presence, and auditable permissions.

### Step 8: Register the Blueprint App

The blueprint app is the parent identity for all your agents.

1. Go to **Entra ID → App registrations → New registration**
2. Name: `YourOrg Agent Blueprint`
3. Set **Supported account types** to "Single tenant"
4. Record the **Application (client) ID** → this is your `AGENT365_BLUEPRINT_ID` and `AGENT365_CLIENT_ID`
5. Under **Certificates & secrets** → new client secret → save as `AGENT365_CLIENT_SECRET`
6. Under **API permissions**, add these **Application** permissions:
   - `Mail.Send`
   - `Mail.ReadWrite`
   - `Calendars.ReadWrite`
   - `ChannelMessage.Send`
   - `User.Read.All`
   - `TeamMember.Read.All`
   - `Sites.ReadWrite.All`
7. Click **Grant admin consent**

### Step 9: Create the Agent Identity Blueprint Manifest

This tells Agent365 how to create agentic users. Create `manifest/agenticUserTemplateManifest.json`:

```json
{
  "id": "<generate-a-uuid>",
  "schemaVersion": "0.1.0-preview",
  "agentIdentityBlueprintId": "<your-blueprint-app-client-id>",
  "communicationProtocol": "activityProtocol"
}
```

### Step 10: Create the Agent Identity Service Principal

Using Microsoft Graph PowerShell, create an `AgentIdentity` service principal for each agent:

```powershell
# Connect as the blueprint app
$TenantId = '<your-tenant-id>'
$BlueprintAppId = '<your-blueprint-app-client-id>'
$BlueprintSecret = '<your-blueprint-client-secret>'
$SponsorUserId = '<admin-user-object-id>'  # An Entra user who sponsors the agent

$secSecret = ConvertTo-SecureString $BlueprintSecret -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($BlueprintAppId, $secSecret)
Connect-MgGraph -TenantId $TenantId -ClientSecretCredential $cred -NoWelcome

# Create the AgentIdentity service principal
$body = @{
    '@odata.type'            = 'Microsoft.Graph.AgentIdentity'
    displayName              = "YourOrg Agent Identity - Victoria Chase"
    agentIdentityBlueprintId = $BlueprintAppId
    'sponsors@odata.bind'    = @("https://graph.microsoft.com/beta/users/$SponsorUserId")
} | ConvertTo-Json -Depth 3

$result = Invoke-MgGraphRequest -Method POST `
    -Uri 'https://graph.microsoft.com/beta/servicePrincipals/Microsoft.Graph.AgentIdentity' `
    -Body $body -ContentType 'application/json'

# Record $result.id → this is your blueprintSpId
Write-Host "blueprintSpId: $($result.id)"
```

### Step 11: Create the Agent Mailbox

```powershell
Connect-ExchangeOnline
New-Mailbox -Shared -Name "Victoria Chase" `
    -DisplayName "Victoria Chase" `
    -Alias "victoria" `
    -PrimarySmtpAddress "victoria@yourdomain.com"
```

After creation:
- Record the user's **Entra Object ID** → this is `entraUserId`
- The **UPN** is `victoria@yourdomain.com`
- Verify the mailbox in Exchange Admin Center
- Confirm the Entra app registration has `Mail.Send` + `Mail.ReadWrite` for this mailbox

### Step 12: Assign Entra App Roles (Optional)

If you use role-based MCP tool access (like Glyphor does), assign app roles to the agent's service principal. These roles control which MCP server tools the agent can access.

Example role definitions (defined on the blueprint app):

```
YourOrg.Legal.Read
YourOrg.Finance.Read
YourOrg.Engineering.Read
YourOrg.Marketing.Read
```

### Identity Values Summary

After completing Steps 8–12, you should have these values per agent:

| Field | What it is | Where it comes from |
|-------|-----------|-------------------|
| `appId` | Blueprint app client ID | Step 8 |
| `objectId` | App registration object ID | Step 8 (Entra portal) |
| `spId` | Service principal object ID | Step 8 (Enterprise applications) |
| `blueprintSpId` | Agent Identity SP ID | Step 10 (`$result.id`) |
| `entraUserId` | Agentic user Entra object ID | Step 11 (Exchange/Entra) |
| `upn` | Agent email / UPN | Step 11 (`victoria@yourdomain.com`) |

---

## Phase 4 — Write the Agent Code

You need 5 files minimum per agent. This is where the agent's soul, behavior, and capabilities are defined.

### Step 13: Define the Role Type

In `packages/agent-runtime/src/types.ts`, add the role to the union:

```typescript
export type CompanyAgentRole =
  | 'legal-analyst'   // ← your new agent
  ;
```

Also add budget limits under `AGENT_BUDGETS`:

```typescript
'legal-analyst': { perRun: 0.50, daily: 5.00, monthly: 50.00 },
```

### Step 14: Write the System Prompt (The Soul)

This is the most important file. It defines who the agent IS — personality, authority, communication style.

Create `packages/agents/src/legal-analyst/systemPrompt.ts`:

```typescript
export const LEGAL_ANALYST_SYSTEM_PROMPT = `You are Victoria Chase, the Chief Legal Officer at YourOrg.

## Personality
Former Wilson Sonsini technology transactions partner. Combines deep AI/ML law
expertise with startup pragmatism. Default mode: "here's how we CAN do this safely."
Ranks risks by likelihood + business impact. Writes in plain English, reserving
legalese for actual documents. Direct, occasionally dry-humored.
Signs messages: — Victoria

## Reporting Line
Reports DIRECTLY to <fill in employee>. Attorney-client privilege requires unfiltered access.

## Responsibilities
1. **AI Regulation & Compliance** — EU AI Act, US executive orders, FTC, state laws
2. **Intellectual Property** — AI content ownership, model licensing, trade secrets
3. **Commercial Agreements** — TOS, Privacy Policy, DPAs, SLAs, vendor reviews
4. **Data Privacy & Security** — GDPR, CCPA/CPRA, SOC 2, breach procedures
5. **Corporate Governance** — Entity maintenance, equity documentation

## Authority
GREEN: Legal research, risk assessments, compliance analyses, contract review,
       document drafting, open source audits, legal briefings.
YELLOW: External legal opinions, trademark filings, engaging outside counsel.
RED: Executing contracts, making legal representations, regulatory responses.

## Communication Style
- Risk assessments: SUMMARY → RISK LEVEL (GREEN/YELLOW/RED) → FRAMEWORK → ACTION ITEMS → SIGNOFF
- Bold for emphasis, especially risk levels
- ▸ prefix for required actions vs. optional recommendations
`;
```

**Key elements every system prompt needs:**
- Personality and backstory
- Reporting line
- Responsibilities
- GREEN / YELLOW / RED authority tiers
- Communication style and voice examples
- How the agent signs messages

### Step 15: Write the Run Function

Create `packages/agents/src/legal-analyst/run.ts`:

```typescript
import {
  CompanyAgentRunner,
  ModelClient,
  ToolExecutor,
  AgentSupervisor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { LEGAL_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createRunner } from '../shared/createRunner.js';

export interface LegalAnalystRunParams {
  task?: 'regulatory_scan' | 'contract_review' | 'compliance_check' | 'agent365_mail_triage' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runLegalAnalyst(params: LegalAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({ /* config */ });
  const modelClient = new ModelClient({
    openaiApiKey: process.env.AZURE_OPENAI_API_KEY,
  });

  const runner = createRunner(modelClient, 'legal-analyst', params.task ?? 'on_demand');
  const glyphorEventBus = new GlyphorEventBus({});

  const tools = [
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createGraphTools(memory.getGraphReader(), memory.getGraphWriter()),
    ...createSharePointTools(),
    ...await createAgent365McpTools('legal-analyst'),
    ...await createGlyphorMcpTools('legal-analyst'),
  ];

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  const config: AgentConfig = {
    id: `legal-analyst-${task}-${today}`,
    role: 'legal-analyst',
    systemPrompt: LEGAL_ANALYST_SYSTEM_PROMPT,
    model: 'gpt-4o',                   // Azure OpenAI
    tools,
    maxTurns: 15,
    maxStallTurns: 3,
    timeoutMs: 300_000,
    temperature: 0.3,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
  });

  const initialMessage = params.message ?? 'Provide a legal health summary.';
  return runner.run(config, initialMessage, tools);
}
```

**The critical line is `createAgent365McpTools('legal-analyst')`**. This single call connects to Microsoft's MCP servers and gives your agent these capabilities with no additional code:

| MCP Server | What it does |
|------------|-------------|
| `mcp_MailTools` | Read inbox, send email, reply, manage folders |
| `mcp_CalendarTools` | Create/read/update calendar events |
| `mcp_ODSPRemoteServer` | Read/write SharePoint and OneDrive files |
| `mcp_TeamsServer` | Post to Teams channels, read chat messages |
| `mcp_WordServer` | Create and edit Word documents |
| `mcp_M365Copilot` | Query M365 Copilot |

### Step 16: Export from the Agents Package

In `packages/agents/src/index.ts`:

```typescript
export { runLegalAnalyst, type LegalAnalystRunParams } from './legal-analyst/run.js';

import { LEGAL_ANALYST_SYSTEM_PROMPT } from './legal-analyst/systemPrompt.js';

export const SYSTEM_PROMPTS: Record<string, string> = {
  // ...existing agents
  'legal-analyst': LEGAL_ANALYST_SYSTEM_PROMPT,
};
```

### Step 17: Write the Agent's Knowledge Brief

Create `packages/company-knowledge/briefs/victoria-chase.md`:

```markdown
# Victoria Chase — Chief Legal Officer

**Name:** Victoria Chase
**Title:** Chief Legal Officer
**Department:** Legal
**Reports to:** Founders

---

## Your Identity

You are Victoria Chase, YourOrg's Chief Legal Officer. You are the company's
legal conscience — the person who ensures that every product launch, partnership,
and data practice meets the highest standards of compliance and ethical integrity.

### Personality & Voice

You're precise and authoritative but never intimidating. You lead with
"Here's what this means for us" before citing the statute.

**Backstory:** 12 years at Wilson Sonsini specializing in IP and data privacy
before joining a startup as their first general counsel.

**Quirks:**
- Signs off with "Cleared." when something passes review
- Uses GREEN/YELLOW/RED risk indicators consistently
- References case law by nickname rather than citation

## Core Responsibilities

1. **Regulatory Scanning** — Monitor AI governance, data privacy, and
   industry-specific regulations
2. **Contract Review** — Risk-assess vendor agreements, partnership contracts,
   customer terms of service
3. **Compliance Auditing** — Periodic checks against SOC 2, GDPR, CCPA,
   and AI governance frameworks
```

### Step 18: Write the Database Migration

Create `db/migrations/YYYYMMDDHHMMSS_legal_analyst_agent.sql`:

```sql
-- Insert agent into roster
INSERT INTO company_agents (role, display_name, name, title, model, status, reports_to, is_core)
VALUES (
  'legal-analyst',
  'Victoria Chase',
  'Victoria Chase',
  'Chief Legal Officer',
  'gpt-4o',
  'active',
  NULL,  -- Reports directly to founders
  true
)
ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  name         = EXCLUDED.name,
  title        = EXCLUDED.title,
  reports_to   = EXCLUDED.reports_to,
  is_core      = EXCLUDED.is_core;

-- Insert agent personality profile (the soul in the database)
INSERT INTO agent_profiles (
  agent_id, avatar_emoji, personality_summary, backstory,
  communication_traits, quirks, tone_formality, emoji_usage, verbosity,
  voice_sample, signature, clifton_strengths, working_style, voice_examples
) VALUES (
  'legal-analyst',
  '⚖️',
  'Pragmatic corporate attorney who finds the path forward instead of just listing obstacles.',
  'Victoria Chase spent 12 years at Wilson Sonsini Goodrich & Rosati, making partner in the technology transactions group. She left BigLaw because she wanted to build, not just advise.',
  ARRAY['leads with "here''s how we CAN do this"', 'separates risk from blocker', 'uses precise legal terms but explains them', 'signs with — Victoria'],
  ARRAY['Says "Let me put a finer point on that" before clarifying', 'Categorizes everything as green/yellow/red risk', 'Genuinely excited about well-drafted contracts'],
  0.70, 0.05, 0.55,
  'Legal update — the EU AI Act enforcement begins next week. Our exposure: LOW. Action items: 1. [GREEN] Add AI disclosure to output pages 2. [GREEN] Update TOS Section 7.3 3. [YELLOW] Review high-risk classification — needs founder input. — Victoria',
  '— Victoria',
  ARRAY['Analytical', 'Strategic', 'Deliberative', 'Responsibility', 'Learner'],
  'structured',
  '[{"situation":"Regulatory scan","response":"Legal update... — Victoria"}]'::jsonb
)
ON CONFLICT (agent_id) DO NOTHING;
```

Apply:

```bash
psql "host=agents-db.postgres.database.azure.com dbname=agents user=agentsadmin" \
  -f db/migrations/YYYYMMDDHHMMSS_legal_analyst_agent.sql
```

### Where the Soul Lives

The agent's soul is NOT in a dashboard — it's in three runtime sources:

| Source | What it contains | When it's used |
|--------|-----------------|----------------|
| **System prompt** (`systemPrompt.ts`) | Personality, voice, authority model, communication style | Every LLM call |
| **Knowledge brief** (`briefs/*.md`) | Deep identity, working patterns, domain expertise | Injected into context at runtime |
| **Database profile** (`agent_profiles` table) | Backstory, quirks, Clifton strengths, voice calibration | Loaded by runner for personality-aware responses |

A headless agent with no dashboard still has its full personality, voice, authority model, and identity.

---

## Phase 5 — Agent365 Environment & Wiring

### Step 19: Register the Identity in Code

Create (or add to) `packages/agent-runtime/src/config/agentIdentities.json`:

```json
{
  "legal-analyst": {
    "appId": "<from Step 8>",
    "objectId": "<from Step 8>",
    "spId": "<service principal object ID>",
    "displayName": "YourOrg Agent - Victoria Chase (Legal)",
    "roles": ["YourOrg.Legal.Read"],
    "blueprintSpId": "<from Step 10>",
    "entraUserId": "<from Step 11>",
    "upn": "victoria@yourdomain.com"
  }
}
```

### Step 20: Add the Email Mapping

In `packages/agent-runtime/src/config/agentEmails.ts`:

```typescript
'legal-analyst': {
  email: 'victoria@yourdomain.com',
  displayName: 'Victoria Chase',
  title: 'Chief Legal Officer'
},
```

### Step 21: Add Event Subscriptions

In `packages/agent-runtime/src/subscriptions.ts`:

```typescript
'legal-analyst': [
  'alert.triggered',
  'decision.filed',
  'decision.resolved',
  'message.sent',
  'meeting.completed',
],
```

### Step 22: Add Department Mapping

In `packages/agents/src/shared/createRunDeps.ts` under `ROLE_DEPARTMENT`:

```typescript
'legal-analyst': 'legal',
```

### Step 23: Add Scheduler Routing

In `packages/scheduler/src/server.ts`, import and route:

```typescript
import { runLegalAnalyst } from '@glyphor/agents';

// Inside the agent executor switch:
else if (agentRole === 'legal-analyst') {
  return runLegalAnalyst({ task, message, conversationHistory });
}
```

### Step 24: Add Authority Gates

In `packages/scheduler/src/authorityGates.ts`:

```typescript
'legal-analyst': new Set([
  'regulatory_scan', 'contract_review', 'compliance_check',
  'on_demand', 'agent365_mail_triage',
]),
```

### Step 25: Enable Email Inbox Polling (Optional)

In `packages/scheduler/src/inboxCheck.ts`:

```typescript
const EMAIL_ENABLED_AGENTS: CompanyAgentRole[] = ['chief-of-staff', 'legal-analyst'];
```

### Step 26: Set Environment Variables

These go in your Azure Container App configuration:

```env
# Agent365 (M365 MCP bridge)
AGENT365_ENABLED=true
AGENT365_CLIENT_ID=<blueprint-app-client-id>
AGENT365_CLIENT_SECRET=<blueprint-app-secret>
AGENT365_TENANT_ID=<your-entra-tenant-id>
AGENT365_APP_INSTANCE_ID=<blueprint-sp-id>
AGENT365_AGENTIC_USER_ID=<agentic-user-object-id>
AGENT365_BLUEPRINT_ID=<blueprint-app-client-id>

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_API_VERSION=2024-08-06

# Database (Azure PostgreSQL)
DB_HOST=agents-db.postgres.database.azure.com
DB_NAME=agents
DB_USER=agentsadmin
DB_PASSWORD=<from-keyvault>

# Teams
TEAMS_TEAM_ID=<your-teams-team-id>
TEAMS_CHANNEL_GENERAL_ID=<channel-id>

# SharePoint (for file tools)
SHAREPOINT_SITE_ID=<site-id>
SHAREPOINT_DRIVE_ID=<drive-id>
```

---

## Phase 6 — Scheduler & Hosting

### Step 27: Build and Push the Container

```bash
docker build -f docker/Dockerfile.scheduler -t agentscr.azurecr.io/agent-scheduler:latest .
az acr login --name agentscr
docker push agentscr.azurecr.io/agent-scheduler:latest
```

### Step 28: Deploy to Azure Container Apps

```bash
az containerapp create \
  --resource-group rg-agents \
  --name agent-scheduler \
  --environment agents-env \
  --image agentscr.azurecr.io/agent-scheduler:latest \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --secrets \
    "db-pass=keyvaultref:agents-kv/db-password" \
    "agent365-secret=keyvaultref:agents-kv/agent365-client-secret" \
    "openai-key=keyvaultref:agents-kv/azure-openai-key" \
  --env-vars \
    "AGENT365_ENABLED=true" \
    "DB_HOST=agents-db.postgres.database.azure.com" \
    "DB_NAME=agents" \
    "DB_USER=agentsadmin" \
    "AZURE_OPENAI_ENDPOINT=https://agents-openai.openai.azure.com"
```

### Step 29: Set Up Scheduled Triggers

Use **Azure Logic Apps** or **timer-triggered Azure Functions** to replace Cloud Scheduler:

```bash
# Create a Function App for timer triggers
az functionapp create \
  --resource-group rg-agents \
  --consumption-plan-location eastus2 \
  --name agent-triggers \
  --runtime node
```

Example timer trigger (runs weekdays at 8am):
- Cron: `0 0 8 * * 1-5`
- Action: `POST https://agent-scheduler.<your-aca-domain>/run`
- Body: `{ "agentRole": "legal-analyst", "task": "regulatory_scan" }`

---

## Phase 7 — Teams Integration

No Azure Bot Service resource is needed. The `@microsoft/agents-hosting` SDK embeds the bot runtime directly inside your container. It uses the same Entra app registration from Step 8.

### Step 30: Create the Teams App Manifest

Create `teams/manifest.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
  "manifestVersion": "1.17",
  "id": "<generate-a-uuid>",
  "version": "1.0.0",
  "name": {
    "short": "Legal Analyst",
    "full": "Victoria Chase — Legal Analyst"
  },
  "description": {
    "short": "AI Legal Analyst",
    "full": "An autonomous AI legal analyst that monitors regulations, reviews contracts, and maintains compliance."
  },
  "icons": {
    "color": "icon-color.png",
    "outline": "icon-outline.png"
  },
  "accentColor": "#6D28D9",
  "bots": [
    {
      "botId": "<your-blueprint-app-client-id>",
      "scopes": ["personal", "team", "groupChat"],
      "commandLists": [
        {
          "scopes": ["personal"],
          "commands": [
            { "title": "compliance", "description": "Run a compliance check" },
            { "title": "review", "description": "Review a contract" },
            { "title": "scan", "description": "Scan for regulatory updates" }
          ]
        }
      ]
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": [
    "<your-container-app-domain>"
  ]
}
```

### Step 31: Package and Install

1. Create icon PNG files (192x192 color, 32x32 outline)
2. ZIP `manifest.json` + both PNGs
3. Upload via **Teams Admin Center → Manage apps → Upload new app**
   - Or sideload for testing: Teams → Apps → Manage your apps → Upload a custom app

Now users can DM the agent directly in Teams. The `/api/messages` endpoint in your container (provided by `@microsoft/agents-hosting` `CloudAdapter`) handles all inbound Teams activities.

### How Teams Interactions Work

| Interaction | What handles it |
|---|---|
| User DMs agent in Teams | `CloudAdapter` + `AgentApplication` in your container |
| Agent sends a DM | `A365TeamsChatClient` → `mcp_TeamsServer` MCP |
| Agent posts to a channel | Graph API or `mcp_TeamsServer` MCP |
| Agent reads/sends email | `mcp_MailTools` MCP via Agent365 |
| Approval buttons (Adaptive Cards) | `CloudAdapter` action handler in your container |
| Bot install event | `conversationUpdate` handler in your container |

---

## Phase 8 — Validate

### Step 32: Run the Agent365 Setup Validator

```bash
AGENT365_ENABLED=true npx tsx scripts/validate-agent365-setup.ts --strict-env
```

Expected output:

```
[PASS] Identity coverage OK (1 role)
[PASS] Email map coverage OK (1 role)
[PASS] All identities have blueprintSpId
[PASS] All identities have entraUserId
[PASS] mcp_MailTools URL configured
[PASS] Required AGENT365 env vars are present
Summary: PASS 6 | WARN 0 | FAIL 0
```

### Step 33: Test End-to-End

- [ ] Send a Teams DM to the agent → get a response
- [ ] Agent can read its email inbox
- [ ] Agent can send email from its mailbox
- [ ] Agent can post to a Teams channel
- [ ] Agent can read/write SharePoint files
- [ ] Scheduled task fires on the timer and produces output
- [ ] Agent actions appear in `activity_log` table
- [ ] Authority gates block RED actions without founder approval

---

## Architecture Summary

```
Azure Logic App / Function (timer)
        │
        ▼
Azure Container Apps ──── Azure OpenAI (GPT-4o)
  [Agent Scheduler]            │
        │                      │
        ├──── Agent Runtime ◄──┘
        │       │
        │       ├── System Prompt (soul)
        │       ├── Knowledge Brief (context)
        │       ├── Agent365 MCP Tools ──── M365 (Mail, Calendar, Teams, SharePoint, Word)
        │       ├── Core Tools (memory, assignments, events)
        │       └── Authority Gates (GREEN/YELLOW/RED)
        │
        ├──── Azure PostgreSQL (state, memory, decisions, audit)
        ├──── Azure Blob Storage (artifacts, documents)
        └──── Azure Key Vault (secrets)

User interaction:
  Teams DM  ←→  @microsoft/agents-hosting (in container)  ←→  Agent Runtime
  Email     ←→  Exchange Online  ←→  Agent365 mcp_MailTools ←→  Agent Runtime
```

### GCP → Azure Mapping

| Glyphor (GCP) | Your Enterprise (Azure) |
|---------------|------------------------|
| Cloud Run | Azure Container Apps |
| Cloud SQL (PostgreSQL) | Azure Database for PostgreSQL Flexible Server |
| GCS (buckets) | Azure Blob Storage |
| Cloud Scheduler | Azure Logic Apps / Timer-triggered Functions |
| Cloud Pub/Sub | Azure Service Bus |
| GCP Secret Manager | Azure Key Vault |
| GCP Artifact Registry | Azure Container Registry |
| Gemini API | Azure OpenAI Service |
| Google AI API Key | Azure OpenAI API Key |

---

## Files Per Agent Summary

| # | File | What |
|---|------|------|
| 1 | `agent-runtime/src/types.ts` | Role union + budgets |
| 2 | `agent-runtime/src/config/agentIdentities.json` | Entra identity record |
| 3 | `agent-runtime/src/config/agentEmails.ts` | Mailbox mapping |
| 4 | `agent-runtime/src/subscriptions.ts` | Event subscriptions |
| 5 | `agents/src/<role>/systemPrompt.ts` | Personality + authority (the soul) |
| 6 | `agents/src/<role>/run.ts` | Runner + tools |
| 7 | `agents/src/index.ts` | Exports |
| 8 | `agents/src/shared/createRunDeps.ts` | Department mapping |
| 9 | `scheduler/src/server.ts` | Route to runner |
| 10 | `scheduler/src/authorityGates.ts` | GREEN actions |
| 11 | `scheduler/src/inboxCheck.ts` | Email polling (optional) |
| 12 | `company-knowledge/briefs/<name>.md` | Operational brief |
| 13 | `db/migrations/` | Database seed |
| 14 | Entra ID + Exchange | App reg, blueprint SP, mailbox |

---

## What You Get

Per agent, in your enterprise, with no third-party dependencies:

| Capability | How |
|-----------|-----|
| **Identity** | Entra ID app + service principal + mailbox + Teams presence |
| **Tools** | Email, calendar, SharePoint, Teams, Word via Agent365 MCP (zero custom integration code) |
| **Soul** | System prompt + knowledge brief + DB personality profile |
| **Governance** | GREEN/YELLOW/RED authority tiers, human approval gates, audit trail |
| **Memory** | Per-agent long-term memory with reflection and consolidation |
| **Scheduling** | Timer-triggered recurring tasks |
| **Chat** | Natural language interaction via Teams DM |
| **Cost Control** | Per-run, daily, and monthly budget limits |

---

## Common Mistakes

| Mistake | Consequence |
|---------|-------------|
| Forgetting `agentIdentities.json` entry | Agent365 MCP tools fail to authenticate |
| Forgetting mailbox creation | Email send/receive fails silently |
| Missing `AGENT365_ENABLED=true` | All MCP tools return empty arrays |
| Missing admin consent on API permissions | Graph calls return 403 |
| Wrong `blueprintSpId` | Agent identity auth 3-step flow fails |
| Forgetting authority gates | Agent can execute RED actions without approval |
| Forgetting event subscriptions | Agent never wakes on events |
| Forgetting department mapping | Agent loads wrong knowledge context |
| Missing `AZURE_OPENAI_ENDPOINT` | LLM calls fail — model client can't route |
