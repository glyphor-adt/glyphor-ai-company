# Cursor Instructions: Migrate to MCP + Entra Agent ID Tool Architecture

## What We're Building

Every Glyphor agent gets a real Entra Agent ID identity. Tools come from MCP servers
scoped by that identity — not from 138 static imports. Agents keep ~12 core tools
for internal operations. Everything else is MCP-served.

This uses the exact pattern already working in `agent365Tools.ts` and
`integrations/agent365/index.ts`. We extend it to Glyphor's own tools.

## Existing Infrastructure (already in place, do not rebuild)

- Blueprint app: `5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a` (SP: `28079457-37d9-483c-b7bb-fe6920083b8e`)
- Client app: `06c728b6-0111-4cb1-a708-d57c51128649`
- Config: `a365.config.json`, `a365.generated.config.json`, `ToolingManifest.json`
- MCP bridge: `packages/integrations/src/agent365/index.ts`
- Tool factory: `packages/agents/src/shared/agent365Tools.ts`
- Auth: `@azure/msal-node` client credentials, `AGENT365_CLIENT_ID`, `AGENT365_CLIENT_SECRET`, `AGENT365_TENANT_ID`
- 5 Microsoft MCP servers already connected: Mail, Calendar, OneDrive/SharePoint, Teams, M365 Copilot
- 46 agent email addresses in `packages/agent-runtime/src/config/agentEmails.ts`
- RuntimeToolFactory in `packages/agent-runtime/src/runtimeToolFactory.ts` (keep as escape hatch)

---

## Step 1: Create Core Tools Module

Extract the tools every agent needs regardless of task into a single module.
These are the ONLY static tools loaded from code. Everything else comes from MCP.

**Create:** `packages/agents/src/shared/coreTools.ts`

Core tools (from existing shared tool files — extract, don't rewrite):

```
FROM assignmentTools.ts:
  read_my_assignments
  submit_assignment_output
  flag_assignment_blocker

FROM communicationTools.ts:
  send_agent_message
  check_messages

FROM memoryTools.ts:
  save_memory
  recall_memories

FROM toolRequestTools.ts:
  request_tool_access
  request_new_tool

FROM eventTools.ts:
  emit_event
```

That's 11 tools. Export a `createCoreTools(deps)` function that returns
`Map<string, ToolDefinition>` with just these 11.

Do NOT delete the original tool files. Other code may import from them.
The core module re-exports the specific functions from those files.

---

## Step 2: Build Glyphor MCP Data Server

This is a new Cloud Run service that exposes Glyphor's PostgreSQL tables as
MCP tools. It replaces the ~60 read-only DB query tools currently spread
across 17 shared tool files.

**Create:** `packages/mcp-data-server/`

```
packages/mcp-data-server/
  src/
    index.ts              — Express server, MCP protocol handler
    auth.ts               — Validate Entra Agent ID tokens from callers
    tools/
      content.ts          — content_drafts, content_metrics queries
      seo.ts              — seo_data queries
      social.ts           — social_metrics, scheduled_posts queries
      email.ts            — email_metrics queries
      finance.ts          — financials, company_pulse MRR queries
      analytics.ts        — analytics_events queries
      support.ts          — support_tickets, knowledge_base queries
      research.ts         — company_research, contact_research queries
      agents.ts           — agent_runs, agent_trust_scores, agent_activities queries
      operations.ts       — data_sync_status, system_status, incidents queries
    scopes.ts             — Maps Entra scopes to allowed table queries
  Dockerfile
  package.json
```

**How it works:**

1. Agent connects via MCP protocol (same as Microsoft's MCP servers)
2. Server validates the caller's Entra Agent ID token
3. Server checks the token's scopes against `scopes.ts`
4. Server exposes only the query tools the caller's scopes allow
5. Agent calls tools, server executes PostgreSQL queries, returns results

**MCP protocol implementation:**

Use `@modelcontextprotocol/sdk` (the official MCP TypeScript SDK).
The server implements `tools/list` (returns available tools based on caller scopes)
and `tools/call` (executes the tool).

Each tool is a parameterized SQL query against Cloud SQL. Use the same
`pg` connection pool pattern from `packages/scheduler/src/dashboardApi.ts`.

**Scopes mapping** (`scopes.ts`):

```typescript
// Entra app roles → allowed table prefixes
export const SCOPE_TABLE_MAP: Record<string, string[]> = {
  'Glyphor.Marketing.Read':    ['content_drafts', 'content_metrics', 'seo_data',
                                 'social_metrics', 'scheduled_posts', 'email_metrics',
                                 'experiment_designs'],
  'Glyphor.Finance.Read':      ['financials', 'company_pulse'],
  'Glyphor.Product.Read':      ['analytics_events'],
  'Glyphor.Support.Read':      ['support_tickets', 'support_responses', 'knowledge_base'],
  'Glyphor.Research.Read':     ['company_research', 'contact_research', 'account_dossiers'],
  'Glyphor.Engineering.Read':  ['agent_runs', 'incidents', 'data_sync_status', 'system_status'],
  'Glyphor.Ops.Read':          ['agent_runs', 'agent_trust_scores', 'data_sync_status',
                                 'system_status', 'incidents', 'company_pulse'],
  'Glyphor.Admin.Read':        ['*'],  // Atlas, Morgan — full read access
};
```

**Deploy:** Cloud Run in `us-central1`, same project (`ai-glyphor-company`).
Add to `docker/Dockerfile.mcp-data-server`. Add to CI/CD pipeline.

**Register in ToolingManifest.json:**

```json
{
  "name": "mcp_GlyphorData",
  "url": "https://glyphor-mcp-data-610179349713.us-central1.run.app/mcp",
  "scopes": ["Glyphor.Marketing.Read", "Glyphor.Finance.Read", "Glyphor.Product.Read",
             "Glyphor.Support.Read", "Glyphor.Research.Read", "Glyphor.Engineering.Read",
             "Glyphor.Ops.Read", "Glyphor.Admin.Read"]
}
```

---

## Step 3: Build Glyphor MCP Action Servers

Same pattern as the data server, but for write operations and external API calls.
Split by domain because write tools need tighter scoping.

**Create:** `packages/mcp-marketing-server/`

Wraps: Mailchimp API (`GLYPHOR_MAILCHIMP_API`), Mandrill API (`GLYPHOR_MANDRILL_API_KEY`),
Google Search Console (`GOOGLE_SEARCH_CONSOLE_CREDENTIALS`), social platform APIs.

Exposes tools currently in: `emailMarketingTools.ts`, `seoTools.ts`,
`socialMediaTools.ts`, `contentTools.ts`, `marketingIntelTools.ts`.

Scopes:
- `Glyphor.Marketing.Content.Write` — create/update drafts, generate images
- `Glyphor.Marketing.Publish` — publish content, send campaigns (YELLOW equivalent)
- `Glyphor.Marketing.SEO.Read` — Search Console queries
- `Glyphor.Marketing.Social.Write` — schedule posts, reply to comments

**Create:** `packages/mcp-engineering-server/`

Wraps: GitHub API (`GITHUB_TOKEN`), Vercel API, GCP Cloud Build, Cloud Run metrics.

Exposes tools currently in: CTO `tools.ts` (get_file_contents, create_or_update_file,
create_branch), `frontendCodeTools.ts`, `deployPreviewTools.ts`.

Scopes:
- `Glyphor.Code.Read` — read files, search code
- `Glyphor.Code.Write` — create/update files on feature branches
- `Glyphor.Deploy.Preview` — preview deployments
- `Glyphor.Deploy.Production` — production deploys (Marcus only)

**Create:** `packages/mcp-design-server/`

Wraps: Playwright (screenshot service), Figma REST API (`FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`),
Storybook, asset pipeline.

Exposes tools currently in: `screenshotTools.ts`, `designSystemTools.ts`, `auditTools.ts`,
`assetTools.ts`, `scaffoldTools.ts`, `figmaTools.ts`, `storybookTools.ts`.

Scopes:
- `Glyphor.Design.Read` — screenshots, audits, token inspection
- `Glyphor.Design.Write` — asset upload, scaffold, design token updates
- `Glyphor.Figma.Read` — file/component/style reads
- `Glyphor.Figma.Write` — comments, dev resources, webhooks

**Create:** `packages/mcp-finance-server/`

Wraps: Stripe API (`STRIPE_SECRET_KEY`), Mercury API (`MERCURY_API_TOKEN`),
BigQuery billing export.

Exposes tools currently in: `revenueTools.ts`, `costManagementTools.ts`, `cashFlowTools.ts`.

Scopes:
- `Glyphor.Finance.Revenue.Read` — Stripe MRR, subscriptions, churn
- `Glyphor.Finance.Cost.Read` — GCP billing, AI model costs, vendor costs
- `Glyphor.Finance.Banking.Read` — Mercury balance, cash flow, transactions

---

## Step 4: Create Per-Agent Entra Identities

Use the Agent 365 CLI (`a365`) to provision agent identities from the existing blueprint.

The blueprint app `5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a` is already created.
Each agent needs an agent identity + agentic user created from this blueprint.

**For each of the 46 agents:**

```bash
# The a365 CLI handles identity creation from the blueprint
# Each agent gets: agent identity + agentic user + M365 license assignment
```

The agentic users already partially exist — each agent has an M365 mailbox
and email address (agentEmails.ts). The Agent 365 license provisions the
full agentic user identity on top of that.

**Define app roles on the blueprint app** for Glyphor-specific scopes:

In Azure Portal → App Registrations → `5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a` →
App Roles, create:

```
Glyphor.Marketing.Read
Glyphor.Marketing.Content.Write
Glyphor.Marketing.Publish
Glyphor.Marketing.SEO.Read
Glyphor.Marketing.Social.Write
Glyphor.Finance.Revenue.Read
Glyphor.Finance.Cost.Read
Glyphor.Finance.Banking.Read
Glyphor.Product.Read
Glyphor.Support.Read
Glyphor.Research.Read
Glyphor.Engineering.Read
Glyphor.Code.Read
Glyphor.Code.Write
Glyphor.Deploy.Preview
Glyphor.Deploy.Production
Glyphor.Design.Read
Glyphor.Design.Write
Glyphor.Figma.Read
Glyphor.Figma.Write
Glyphor.Ops.Read
Glyphor.Admin.Read
```

**Assign roles to each agent identity:**

```
Sarah Chen (chief-of-staff):     Glyphor.Admin.Read, Glyphor.Ops.Read
Marcus Reeves (cto):             Glyphor.Code.Read, Glyphor.Code.Write, Glyphor.Deploy.Production, Glyphor.Engineering.Read
Nadia Okafor (cfo):              Glyphor.Finance.Revenue.Read, Glyphor.Finance.Cost.Read, Glyphor.Finance.Banking.Read
Maya Brooks (cmo):               Glyphor.Marketing.Read, Glyphor.Marketing.Content.Write, Glyphor.Marketing.Publish, Glyphor.Marketing.Social.Write
Elena Vasquez (cpo):             Glyphor.Product.Read, Glyphor.Research.Read
Mia Tanaka (vp-design):          Glyphor.Design.Read, Glyphor.Design.Write, Glyphor.Figma.Read, Glyphor.Figma.Write, Glyphor.Code.Read
Victoria Chase (clo):            Glyphor.Admin.Read
James Turner (vp-cs):            Glyphor.Support.Read, Glyphor.Product.Read
Rachel Kim (vp-sales):           Glyphor.Research.Read
Sophia Lin (vp-research):        Glyphor.Research.Read, Glyphor.Product.Read

Tyler Reed (content-creator):    Glyphor.Marketing.Read, Glyphor.Marketing.Content.Write
Lisa Chen (seo-analyst):         Glyphor.Marketing.SEO.Read, Glyphor.Marketing.Read
Kai Johnson (social-media):      Glyphor.Marketing.Read, Glyphor.Marketing.Social.Write
Anna Park (revenue-analyst):     Glyphor.Finance.Revenue.Read
Omar Hassan (cost-analyst):      Glyphor.Finance.Cost.Read
Priya Sharma (user-researcher):  Glyphor.Product.Read, Glyphor.Support.Read
Daniel Ortiz (competitive-intel):Glyphor.Product.Read, Glyphor.Research.Read
Leo Vargas (ui-ux-designer):     Glyphor.Design.Read, Glyphor.Figma.Read
Ava Chen (frontend-engineer):    Glyphor.Design.Read, Glyphor.Code.Read, Glyphor.Code.Write
Sofia Marchetti (design-critic): Glyphor.Design.Read, Glyphor.Figma.Read
Ryan Park (template-architect):  Glyphor.Design.Read, Glyphor.Design.Write, Glyphor.Code.Read, Glyphor.Code.Write

Alex Park (platform-engineer):   Glyphor.Code.Read, Glyphor.Code.Write, Glyphor.Engineering.Read
Sam DeLuca (quality-engineer):   Glyphor.Code.Read, Glyphor.Engineering.Read
Jordan Hayes (devops-engineer):  Glyphor.Code.Read, Glyphor.Deploy.Preview, Glyphor.Engineering.Read
Riley Morgan (m365-admin):       Glyphor.Admin.Read

Atlas Vega (ops):                Glyphor.Ops.Read, Glyphor.Admin.Read
Morgan Blake (global-admin):     Glyphor.Admin.Read

Research analysts (all 6):       Glyphor.Research.Read
Jasmine Rivera (hr):             Glyphor.Admin.Read
```

Morgan Blake (Global Admin) manages these assignments through the Entra admin
center. His existing tools (`platform_iam_state`, `provision_access`, `audit_access`)
should be updated to read/write Entra Agent ID role assignments.

---

## Step 5: Update the MCP Bridge for Per-Agent Auth

Currently `integrations/agent365/index.ts` uses a single MSAL client credential
for all agents. Update it to acquire tokens per agent identity.

**Modify:** `packages/integrations/src/agent365/index.ts`

```typescript
// CURRENT: one shared MSAL client
const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AGENT365_CLIENT_ID,
    clientSecret: process.env.AGENT365_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AGENT365_TENANT_ID}`
  }
});

// NEW: per-agent identity token acquisition
// The agent identity authenticates using the blueprint's client credentials
// but includes the agent identity ID in the token request.
// The MCP server sees the agent identity's scopes, not the blueprint's.
export async function getAgentToken(agentRole: string, audience: string): Promise<string> {
  // Look up agent identity ID from DB or config
  const agentIdentityId = await getAgentIdentityId(agentRole);

  // Acquire token with the agent's specific scopes
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: [`${audience}/.default`],
    claims: JSON.stringify({ agent_identity_id: agentIdentityId })
  });

  return result.accessToken;
}
```

The exact token acquisition flow depends on how Microsoft's Agent 365 SDK
provisions per-agent tokens. Check `@microsoft/agents-a365-runtime` docs for
`AgentIdentityTokenProvider` or similar. The SDK may handle this automatically
when you pass the agent identity ID.

**Create:** `packages/agents/src/shared/glyphorMcpTools.ts`

Same pattern as `agent365Tools.ts` but connects to Glyphor's MCP servers:

```typescript
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';

export async function createGlyphorMcpTools(
  agentRole: string,
  serverFilter?: string[]
): Promise<Map<string, ToolDefinition>> {
  if (process.env.GLYPHOR_MCP_ENABLED !== 'true') return new Map();

  // Read Glyphor MCP servers from ToolingManifest.json
  // (same manifest, new entries alongside Microsoft's servers)
  const configService = new McpToolServerConfigurationService();

  // Filter to requested servers
  const servers = serverFilter
    ? configService.getServers().filter(s => serverFilter.includes(s.name))
    : configService.getServers().filter(s => s.name.startsWith('mcp_Glyphor'));

  // Get per-agent token for each server
  const tools = new Map<string, ToolDefinition>();
  for (const server of servers) {
    const token = await getAgentToken(agentRole, server.audience);
    const serverTools = await server.listTools(token);

    for (const tool of serverTools) {
      tools.set(tool.name, convertToGlyphorToolDef(tool, server, token));
    }
  }

  return tools;
}
```

---

## Step 6: Update Agent tools.ts Files

Every agent's `tools.ts` changes from importing 10-30 shared tool files to
loading core tools + MCP connections.

**Pattern for every agent:**

```typescript
// packages/agents/src/{role}/tools.ts

import { createCoreTools } from '../shared/coreTools';
import { createAgent365McpTools } from '../shared/agent365Tools';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools';

export async function createTools(deps: RunDependencies): Promise<Map<string, ToolDefinition>> {
  const [core, a365, glyphor] = await Promise.all([
    createCoreTools(deps),
    createAgent365McpTools(this.role, ['mcp_CalendarTools', 'mcp_TeamsServer']),
    createGlyphorMcpTools(this.role),  // scoping handled by Entra identity
  ]);

  return new Map([...core, ...a365, ...glyphor]);
}
```

Because Entra scopes determine which tools each server exposes to each agent,
you don't need per-agent server filters on the Glyphor MCP servers. Maya calls
`createGlyphorMcpTools('cmo')`, her identity has `Glyphor.Marketing.*` scopes,
the data server returns marketing query tools, the marketing server returns
Mailchimp/Mandrill/social/SEO tools. Lisa calls the same function, her identity
has `Glyphor.Marketing.SEO.Read`, she gets only SEO tools.

**Specific agent configs** (only specify A365 server filters — Glyphor servers
are identity-scoped):

```
C-Suite (Sarah, Marcus, Nadia, Elena, Maya, Victoria):
  A365: ['mcp_MailTools', 'mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']

Sub-team (Tyler, Lisa, Kai, Anna, Omar, etc.):
  A365: ['mcp_CalendarTools', 'mcp_TeamsServer']

Research (Sophia + 6 analysts):
  A365: ['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']

Design (Mia, Leo, Ava, Sofia, Ryan):
  A365: ['mcp_CalendarTools', 'mcp_TeamsServer']

Ops (Atlas, Morgan):
  A365: ['mcp_MailTools', 'mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_ODSPRemoteServer']
```

---

## Step 7: Simplify toolExecutor.ts

With MCP-served tools authenticated by Entra Agent ID, the 5-layer enforcement
in `toolExecutor.ts` simplifies:

**Current 5 layers:**
1. Grant check (agent_tool_grants DB lookup)
2. Scope check
3. Rate limit check
4. Budget check
5. Execute + timeout

**New 3 layers:**
1. Budget check (keep — controls LLM cost, not tool access)
2. Rate limit check (keep — prevents runaway loops)
3. Execute + timeout

Grant check and scope check are now handled by the MCP server + Entra identity.
If the agent's identity doesn't have the scope, the MCP server never exposes
the tool. The agent can't call a tool it can't see.

**For core tools** (the 11 static tools): these bypass all checks as they
do today (static tool bypass). No change needed.

**For MCP tools**: the tool handler calls the MCP server, which already validated
the agent's identity. ToolExecutor just needs budget + rate limit + execute.

**Keep `agent_tool_grants` as an override layer** for emergencies. If you need
to block a specific agent from a specific tool immediately (faster than updating
Entra roles), the grant table can have `is_blocked` entries that toolExecutor
checks before MCP execution.

---

## Step 8: Update ToolingManifest.json

Add Glyphor MCP servers alongside the existing Microsoft servers:

```json
{
  "servers": [
    {
      "name": "mcp_MailTools",
      "url": "https://agent365.svc.cloud.microsoft/mail/mcp",
      "scopes": ["McpServers.Mail.All"]
    },
    {
      "name": "mcp_CalendarTools",
      "url": "https://agent365.svc.cloud.microsoft/calendar/mcp",
      "scopes": ["McpServers.Calendar.All"]
    },
    {
      "name": "mcp_ODSPRemoteServer",
      "url": "https://agent365.svc.cloud.microsoft/odsp/mcp",
      "scopes": ["McpServers.OneDriveSharepoint.All"]
    },
    {
      "name": "mcp_TeamsServer",
      "url": "https://agent365.svc.cloud.microsoft/teams/mcp",
      "scopes": ["McpServers.Teams.All"]
    },
    {
      "name": "mcp_M365Copilot",
      "url": "https://agent365.svc.cloud.microsoft/copilot/mcp",
      "scopes": ["McpServers.CopilotMCP.All"]
    },
    {
      "name": "mcp_GlyphorData",
      "url": "https://glyphor-mcp-data-610179349713.us-central1.run.app/mcp",
      "scopes": ["Glyphor.Marketing.Read", "Glyphor.Finance.Revenue.Read",
                 "Glyphor.Finance.Cost.Read", "Glyphor.Finance.Banking.Read",
                 "Glyphor.Product.Read", "Glyphor.Support.Read",
                 "Glyphor.Research.Read", "Glyphor.Engineering.Read",
                 "Glyphor.Ops.Read", "Glyphor.Admin.Read"]
    },
    {
      "name": "mcp_GlyphorMarketing",
      "url": "https://glyphor-mcp-marketing-610179349713.us-central1.run.app/mcp",
      "scopes": ["Glyphor.Marketing.Content.Write", "Glyphor.Marketing.Publish",
                 "Glyphor.Marketing.SEO.Read", "Glyphor.Marketing.Social.Write"]
    },
    {
      "name": "mcp_GlyphorEngineering",
      "url": "https://glyphor-mcp-engineering-610179349713.us-central1.run.app/mcp",
      "scopes": ["Glyphor.Code.Read", "Glyphor.Code.Write",
                 "Glyphor.Deploy.Preview", "Glyphor.Deploy.Production"]
    },
    {
      "name": "mcp_GlyphorDesign",
      "url": "https://glyphor-mcp-design-610179349713.us-central1.run.app/mcp",
      "scopes": ["Glyphor.Design.Read", "Glyphor.Design.Write",
                 "Glyphor.Figma.Read", "Glyphor.Figma.Write"]
    },
    {
      "name": "mcp_GlyphorFinance",
      "url": "https://glyphor-mcp-finance-610179349713.us-central1.run.app/mcp",
      "scopes": ["Glyphor.Finance.Revenue.Read", "Glyphor.Finance.Cost.Read",
                 "Glyphor.Finance.Banking.Read"]
    }
  ]
}
```

---

## Step 9: Infrastructure

**New Cloud Run services (5):**

| Service | Image | Memory | Port |
|---------|-------|--------|------|
| `glyphor-mcp-data` | `Dockerfile.mcp-data-server` | 256MB | 8080 |
| `glyphor-mcp-marketing` | `Dockerfile.mcp-marketing-server` | 256MB | 8080 |
| `glyphor-mcp-engineering` | `Dockerfile.mcp-engineering-server` | 256MB | 8080 |
| `glyphor-mcp-design` | `Dockerfile.mcp-design-server` | 512MB | 8080 |
| `glyphor-mcp-finance` | `Dockerfile.mcp-finance-server` | 256MB | 8080 |

All services need:
- Cloud SQL connection (same DB_HOST, DB_NAME, DB_USER, DB_PASSWORD)
- Entra token validation (verify tokens from agent identities)
- Their domain-specific API keys (marketing server gets Mailchimp/Mandrill keys, etc.)

**Add to CI/CD** (`.github/workflows/deploy.yml`): build + deploy for each
new service, same pattern as scheduler and worker.

**GCP Secret Manager:** No new secrets needed. Each MCP server gets the
secrets relevant to its domain from existing secrets. The data server gets
DB creds. The marketing server gets DB creds + Mailchimp + Mandrill keys.
The finance server gets DB creds + Stripe + Mercury keys.

**Network:** MCP servers are internal services called by the scheduler/worker.
Use Cloud Run IAM (`--no-allow-unauthenticated`) + service account auth,
OR validate Entra tokens on every request. Entra token validation is preferred
because it's the same auth model the agent uses for Microsoft's MCP servers.

---

## Build Order

```
Week 1:
  1. Create coreTools.ts (extract 11 tools from existing files)
  2. Build mcp-data-server (read-only DB queries, biggest tool reduction)
  3. Create glyphorMcpTools.ts (bridge, same pattern as agent365Tools.ts)
  4. Update ONE agent (Maya/CMO) to use core + MCP, verify it works

Week 2:
  5. Define Entra app roles on blueprint app
  6. Create agent identities for all 46 agents via a365 CLI
  7. Assign Entra roles per agent
  8. Update MCP bridge for per-agent token acquisition
  9. Update Maya to use per-agent auth, verify scoping works

Week 3:
  10. Build mcp-marketing-server (Mailchimp, Mandrill, Search Console, social)
  11. Build mcp-finance-server (Stripe, Mercury, BigQuery billing)
  12. Migrate CMO team + CFO team to core + MCP

Week 4:
  13. Build mcp-engineering-server (GitHub, Vercel, Cloud Run)
  14. Build mcp-design-server (Playwright, Figma, Storybook, assets)
  15. Migrate remaining agents to core + MCP
  16. Simplify toolExecutor.ts (remove grant/scope layers for MCP tools)

Week 5:
  17. Remove static tool imports from all agent tools.ts files
  18. Verify all agents function correctly with MCP-only tools
  19. Update ARCHITECTURE.md
```

---

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/coreTools.ts` | 11 always-loaded core tools |
| `packages/agents/src/shared/glyphorMcpTools.ts` | Bridge to Glyphor MCP servers |
| `packages/mcp-data-server/` | Read-only DB query MCP server |
| `packages/mcp-marketing-server/` | Mailchimp, Mandrill, Search Console, social APIs |
| `packages/mcp-engineering-server/` | GitHub, Vercel, Cloud Run, GCP monitoring |
| `packages/mcp-design-server/` | Playwright, Figma, Storybook, asset pipeline |
| `packages/mcp-finance-server/` | Stripe, Mercury, BigQuery billing |
| `docker/Dockerfile.mcp-data-server` | Docker build for data MCP server |
| `docker/Dockerfile.mcp-marketing-server` | Docker build for marketing MCP server |
| `docker/Dockerfile.mcp-engineering-server` | Docker build for engineering MCP server |
| `docker/Dockerfile.mcp-design-server` | Docker build for design MCP server |
| `docker/Dockerfile.mcp-finance-server` | Docker build for finance MCP server |

## Files Modified

| File | Change |
|------|--------|
| `ToolingManifest.json` | Add 5 Glyphor MCP server entries |
| `packages/integrations/src/agent365/index.ts` | Per-agent token acquisition |
| `packages/agent-runtime/src/toolExecutor.ts` | Simplify: remove grant/scope for MCP tools |
| All 46 agent `tools.ts` files | Replace static imports with core + MCP |
| `.github/workflows/deploy.yml` | Add build+deploy for 5 new MCP services |
| `a365.config.json` | Add Glyphor MCP server references |

## Files NOT Deleted (keep for reference, runtime factory fallback)

All existing shared tool files (`contentTools.ts`, `seoTools.ts`, etc.) remain
in the repo. RuntimeToolFactory can still synthesize tools from these patterns.
Remove the imports from agent tools.ts files but don't delete the implementations.