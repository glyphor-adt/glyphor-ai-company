# Cursor Instructions: Agent Tool Architecture Rethink

## The Question

With Agent 365 MCP integration live and Microsoft agent licenses provisioned, do we
need 138+ statically-wired tools per agent? Or should agents have core tools and
discover/create tools as needed? Does Entra ID per-agent identity change the tooling
model?

The answer is yes to all three. Agent 365 MCP already proves the model you should be
using everywhere. You just haven't generalized it yet.

---

## What You Currently Have: Three Tool Paradigms Coexisting

### Paradigm 1 — Static Tools (the 138+ problem)

Tools are coded in shared/*.ts files, imported into each agent's tools.ts, added to
the this.tools Map, and declared to the LLM on every call. This is the paradigm that
created the 128-tool cap problem, the grant management overhead, and the "agent says
it doesn't have access" failures.

Every tool must be:
1. Coded in a shared tool file
2. Imported into the agent's tools.ts
3. Added to the agent's static tool Map
4. Registered in KNOWN_TOOLS or tool_registry
5. Granted in agent_tool_grants
6. Declared to the LLM on every model call

Six places that must stay in sync. If any one breaks, the tool silently fails.

### Paradigm 2 — Agent 365 MCP (already working)

Tools are DISCOVERED from Microsoft MCP servers at runtime. The agent calls
createAgent365McpTools(serverFilter?) and gets back tools that the MCP server
exposes. No manual coding per tool. No grant management per tool. The server
defines what's available, the bridge converts schemas, the agent uses them.

```
Agent run.ts → createAgent365McpTools(['mcp_MailTools', 'mcp_CalendarTools'])
  → MCP bridge discovers available tools from those servers
  → Converts to ToolDefinition format
  → Agent uses them
```

The agent doesn't know in advance exactly which mail tools exist. It says "give me
mail tools" and gets whatever the MCP server currently exposes. If Microsoft adds a
new mail capability tomorrow, the agent gets it automatically.

### Paradigm 3 — Runtime Tool Factory (already working)

Agents synthesize tools mid-run when no existing tool covers their need. Three types:
HTTP fetch, Cloud SQL query, sandboxed JavaScript. Max 3 per run, 20 persisted.

This is the "last resort" — agent realizes it needs something, builds it on the fly.

---

## The Rethink: Core + Discover + Create

Instead of 138 static tools, every agent gets:

### Layer 1 — Core Tools (8-12 tools, ALWAYS loaded, never filtered)

These are the tools that define what it means to be a Glyphor agent:

```
ASSIGNMENT TOOLS (work management):
  read_my_assignments          — check your inbox
  submit_assignment_output     — deliver your work
  flag_assignment_blocker      — escalate problems

COMMUNICATION TOOLS (inter-agent):
  send_agent_message           — DM another agent
  check_messages               — read your DMs

MEMORY TOOLS (persistence):
  save_memory                  — remember something
  recall_memories              — retrieve memories

SELF-SERVICE TOOLS (autonomy):
  request_tool_access          — self-grant a tool
  request_new_tool             — request a tool that doesn't exist
  discover_tools               — NEW: list available tools by domain
```

That's 10 tools. Every agent. Every run. Always available. Never filtered.

### Layer 2 — MCP Tool Servers (discovered at runtime, scoped by identity)

This is where Agent 365 already works. Generalize it to ALL external services:

```
MICROSOFT M365 (Agent 365, already live):
  mcp_MailTools                — Outlook email
  mcp_CalendarTools            — Calendar management
  mcp_ODSPRemoteServer         — OneDrive/SharePoint
  mcp_TeamsServer              — Teams messaging
  mcp_M365Copilot              — M365 Copilot

GLYPHOR INTERNAL (new MCP servers you build):
  mcp_GlyphorData              — Supabase/PostgreSQL queries
    Exposes: query_analytics_events, get_content_drafts, get_seo_data,
    get_financials, get_support_tickets, get_company_pulse...
    (All the read-only DB queries that are currently static tools)

  mcp_GlyphorGitHub            — GitHub operations
    Exposes: get_file_contents, create_or_update_file, create_branch,
    list_prs, check_ci_status...

  mcp_GlyphorDesign            — Design tools
    Exposes: screenshot_page, run_lighthouse, check_responsive,
    figma_* tools, storybook_* tools...

  mcp_GlyphorMarketing         — Marketing tools
    Exposes: mailchimp_*, mandrill_*, social_*, seo_*...

  mcp_GlyphorFinance           — Finance tools
    Exposes: stripe_*, mercury_*, gcp_billing_*...
```

Each agent connects to the MCP servers relevant to their role. The tools are
discovered from the server, not compiled into the agent's code.

**The agent's tools.ts changes from:**

```typescript
// CURRENT: 50+ imports, 50+ tool registrations
import { createContentTools } from '../shared/contentTools';
import { createSeoTools } from '../shared/seoTools';
import { createSocialTools } from '../shared/socialMediaTools';
import { createEmailMarketingTools } from '../shared/emailMarketingTools';
// ... 20 more imports

export function createTools(deps) {
  return new Map([
    ...createContentTools(deps),
    ...createSeoTools(deps),
    ...createSocialTools(deps),
    ...createEmailMarketingTools(deps),
    // ... 20 more spreads
  ]);
}
```

**To:**

```typescript
// NEW: core tools + MCP server connections
import { CORE_TOOLS } from '../shared/coreTools';
import { createAgent365McpTools } from '../shared/agent365Tools';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools';

export function createTools(deps) {
  return new Map([
    ...CORE_TOOLS(deps),
    ...createAgent365McpTools(['mcp_MailTools', 'mcp_CalendarTools']),
    ...createGlyphorMcpTools(['mcp_GlyphorMarketing']),
  ]);
}
```

Maya (CMO) connects to mcp_GlyphorMarketing and gets all the Mailchimp, Mandrill,
social, SEO, and content tools. Lisa (SEO Analyst) connects to the same server
but her identity only grants her the SEO tools within it (see Layer 4).

### Layer 3 — Runtime Tool Factory (already built, expand it)

For truly novel needs — a one-off API call, a custom SQL query, a calculation the
agent needs. Already limited to 3 per run, 20 persisted. This stays as the escape
hatch.

### Layer 4 — Entra ID Per-Agent Identity (the permission layer)

THIS is where Entra ID changes everything. Right now:

```
CURRENT: One Entra ID app → one service principal → all agents share it
  → Tool permissions managed in code (agent_tool_grants table)
  → 6-gate pipeline between tool and execution
  → Every new tool needs: code, import, register, grant, wire, declare
```

With per-agent Entra IDs:

```
NEW: One Entra ID per agent → scoped permissions per identity
  → Tool permissions managed in Entra (Microsoft manages the grants)
  → MCP servers enforce permissions based on caller identity
  → New tools just need: exist on MCP server + agent identity has scope
```

**How it works:**

Step 1 — Create an Entra ID managed identity or app registration per agent:

```
sarah-chen@glyphor.ai        → Entra ID: sarah-chen-agent
marcus-reeves@glyphor.ai     → Entra ID: marcus-reeves-agent
maya-brooks@glyphor.ai       → Entra ID: maya-brooks-agent
lisa-chen@glyphor.ai         → Entra ID: lisa-chen-agent
...
```

Each agent already has an M365 mailbox and email address (46 agent emails
in agentEmails.ts). The Agent 365 licenses you just bought give each of them
a first-class M365 identity.

Step 2 — Scope permissions per identity:

```
maya-brooks-agent:
  M365 scopes: Mail.ReadWrite, Calendar.ReadWrite, Sites.Read.All
  Glyphor scopes: marketing.read, marketing.write, content.publish
  GitHub scopes: repos.read (frontend paths only)

lisa-chen-agent:
  M365 scopes: Mail.Read, Calendar.Read
  Glyphor scopes: marketing.read, seo.read, seo.write
  GitHub scopes: none

marcus-reeves-agent:
  M365 scopes: Mail.ReadWrite, Calendar.ReadWrite, Sites.ReadWrite.All
  Glyphor scopes: engineering.*, admin.deploy
  GitHub scopes: repos.read, repos.write
```

Step 3 — MCP servers check caller identity:

When Maya's agent connects to mcp_GlyphorMarketing, the MCP server checks her
Entra identity and exposes only the tools her scopes allow. Lisa connects to the
same server but gets fewer tools because her scopes are narrower.

**What this replaces:**

| Current System | Entra Identity System |
|---------------|----------------------|
| agent_tool_grants DB table | Entra ID permission scopes |
| toolExecutor.isToolGranted() | MCP server checks caller identity |
| request_tool_access / self-grant | Admin assigns scopes in Entra portal |
| KNOWN_TOOLS registry | MCP server tool manifest |
| Static tool bypass logic | No concept of static vs dynamic — all tools are server-discovered |
| Grant cache (60s TTL) | Entra token cache (managed by MSAL) |
| Sarah grant_tool_access | Entra admin role or Morgan (Global Admin) manages in portal |

**The agent_tool_grants table doesn't disappear immediately** — it remains as an
override layer for fine-grained control that Entra scopes can't express. But the
primary permission model shifts from "DB grant per tool per agent" to "identity
scope per service per agent."

---

## The New Tool Count Per Agent

| Layer | Tools | Source |
|-------|-------|--------|
| Core | 10-12 | Always loaded, never filtered |
| Agent 365 MCP | 15-30 | Discovered from M365 MCP servers |
| Glyphor MCP | 10-40 | Discovered from internal MCP servers, scoped by identity |
| Runtime Factory | 0-3 | Created on demand during run |
| **Total per call** | **35-85** | **Well under 128 cap** |

Compare to current: 138+ static tools on every call, hitting the 128 cap,
with role-specific tools silently dropped.

---

## Building the Glyphor MCP Servers

You don't need to build 5 servers on day one. Start with one that covers the
biggest tool category — the DB read tools that every department needs.

### Server 1 — mcp_GlyphorData (replaces ~60 static read tools)

This single MCP server wraps your PostgreSQL tables and exposes them as tools.
Every tool that currently does `db.from('table').select(...)` becomes a tool
on this server.

Implementation: The server is a Node.js HTTP service (or Cloud Run service) that:
1. Registers as an MCP server with a tool manifest
2. Exposes query tools per table/view (read-only)
3. Checks caller identity for table-level permissions
4. Returns results as structured JSON

```
Tools exposed:
  query_content_drafts      — content_drafts table
  query_content_metrics     — content_metrics table
  query_seo_data            — seo_data table
  query_social_metrics      — social_metrics table
  query_scheduled_posts     — scheduled_posts table
  query_email_metrics       — email_metrics table
  query_support_tickets     — support_tickets table
  query_analytics_events    — analytics_events table
  query_company_research    — company_research table
  query_financials          — financials table
  query_agent_runs          — agent_runs table
  query_company_pulse       — company_pulse table
  get_agent_health          — derived agent health view
  ... (one per table the agents need to read)
```

Identity scoping:
- Maya (CMO): can query content_*, social_*, email_*, seo_*
- Lisa (SEO): can query seo_*, content_metrics (read only)
- Nadia (CFO): can query financials, agent_runs (cost data), company_pulse
- Priya (Researcher): can query analytics_events, support_tickets
- Atlas (Ops): can query everything (system health)

### Server 2 — mcp_GlyphorMarketing (replaces ~40 static marketing tools)

Wraps Mailchimp, Mandrill, Search Console, social platform APIs.

```
Tools exposed:
  mailchimp_get_lists, mailchimp_get_members, mailchimp_create_campaign,
  mailchimp_set_content, mailchimp_send_test, mailchimp_send, ...
  mandrill_send, mandrill_stats, mandrill_search, mandrill_templates, ...
  search_console_performance, search_console_indexing, ...
  social_schedule_post, social_get_metrics, social_get_audience, ...
```

Identity scoping:
- Maya: full access (read + write + send)
- Tyler: content creation + test sends (no live sends)
- Lisa: Search Console read only
- Kai: social platform full access

### Server 3 — mcp_GlyphorEngineering (replaces ~50 CTO tools)

Wraps GitHub, Vercel, Cloud Run, GCP monitoring.

### Server 4 — mcp_GlyphorDesign (replaces ~50 design tools)

Wraps Playwright screenshots, Figma, Storybook, asset pipeline.

### Server 5 — mcp_GlyphorFinance (replaces ~30 finance tools)

Wraps Stripe (direct API), Mercury (direct API), GCP billing.

---

## The discover_tools Tool

New core tool that lets agents find tools they need:

```typescript
// discover_tools — part of the core tool set
{
  name: 'discover_tools',
  description: 'List available tools from MCP servers by domain or keyword. ' +
    'Use this when you need a capability you don\'t see in your current tools.',
  parameters: {
    domain: {
      type: 'string',
      description: 'Domain to search: marketing, finance, engineering, design, ' +
        'data, research, legal, hr, ops',
    },
    keyword: {
      type: 'string',
      description: 'Keyword to search tool names and descriptions',
    }
  },
  execute: async (params) => {
    // Query all connected MCP servers for matching tools
    // Return: tool name, description, which server it's on, whether caller has access
    const results = await mcpRegistry.searchTools(params.domain, params.keyword, callerIdentity);
    return results.map(t => ({
      name: t.name,
      description: t.description,
      server: t.server,
      hasAccess: t.callerHasScope,
      requestAccessVia: t.callerHasScope ? null : 'request_tool_access'
    }));
  }
}
```

Now when an agent needs to do something it hasn't done before:

```
Agent: "I need to check Mailchimp campaign performance"
  → calls discover_tools({ domain: 'marketing', keyword: 'campaign' })
  → gets back: mailchimp_get_campaign_report (mcp_GlyphorMarketing, hasAccess: true)
  → calls mailchimp_get_campaign_report(campaign_id)
  → gets data
```

The agent doesn't need the tool pre-loaded. It discovers it, confirms access,
and uses it — all within a single run.

---

## Entra ID Implementation

### Option A — Managed Identities (simpler, GCP-compatible)

Each agent gets a User Assigned Managed Identity in Azure. MSAL acquires tokens
per-identity. MCP servers validate the identity's scopes.

Pros: No passwords/secrets to rotate per agent
Cons: Requires Azure infrastructure for the managed identities

### Option B — App Registrations Per Agent (more control)

Each agent gets its own Entra app registration with client credentials. This is
what you already have for the 10 agent bots — extend it to all agents.

Pros: Full control over scopes, can add custom app roles
Cons: More secret management (though GCP Secret Manager handles this)

### Option C — Agent 365 Licenses = Agent Identities (you already have this)

The Agent 365 licenses you just bought may already provision per-agent identities.
Check: does each agent's M365 license include an Entra identity? If so, those
identities already have M365 scopes and you just need to:
1. Add custom app roles for Glyphor-specific scopes
2. Use those identities when agents connect to Glyphor MCP servers

**This is likely the fastest path** — the identities may already exist.

### What Morgan Blake (Global Admin) Manages

Morgan already handles "cross-platform access provisioning (GCP, Entra ID, M365,
GitHub, Vercel, Stripe)." Per-agent Entra identities become part of his domain:

- Provisioning new agent identities when agents are created
- Assigning scopes based on role and department
- Rotating credentials (or using managed identities to avoid this)
- Auditing access — which agent accessed which service when
- Drift detection — does the agent's actual usage match its scoped permissions?

This is already in Morgan's toolset (platform_iam_state, provision_access,
audit_access). The Entra identities give him a real platform to manage instead
of a DB table.

---

## Implementation Plan

### Phase 1 — Core Tool Extraction (Day 1)

Extract the 10-12 core tools into a standalone CORE_TOOLS set. Every agent
loads these and nothing else from the static tool system.

File: packages/agents/src/shared/coreTools.ts

```typescript
export const CORE_TOOLS = [
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
  'save_memory',
  'recall_memories',
  'request_tool_access',
  'request_new_tool',
  'discover_tools',        // NEW
];
```

All other static tools remain available but are NOT auto-loaded. They're
accessed via request_tool_access (self-grant) or discover_tools (MCP).

### Phase 2 — First Glyphor MCP Server (Week 1)

Build mcp_GlyphorData — the read-only database query server. This replaces
the ~60 static read tools (get_content_drafts, get_seo_data, get_financials,
query_analytics_events, etc.) with a single MCP server.

Implementation: Express/Fastify HTTP service on Cloud Run, implements MCP protocol,
queries PostgreSQL, returns structured results.

### Phase 3 — Per-Agent Entra Identity (Week 2)

Determine which Option (A/B/C) the Agent 365 licenses support. If the licenses
already include Entra identities, add custom app roles and wire them.

If not, create app registrations per agent (extending the existing pattern of
10 agent bot registrations to all 46 agents).

Wire MSAL to acquire per-agent tokens when connecting to MCP servers.

### Phase 4 — Remaining Glyphor MCP Servers (Weeks 3-4)

Build mcp_GlyphorMarketing, mcp_GlyphorEngineering, mcp_GlyphorDesign,
mcp_GlyphorFinance — migrating the department-specific static tools into
MCP-served, identity-scoped tools.

### Phase 5 — Deprecate Static Tools (Week 5)

Once MCP servers are serving all department tools:
1. Remove static tool imports from agent tools.ts files
2. Keep CORE_TOOLS as the only static tools
3. agent_tool_grants becomes an override/audit layer, not the primary gate
4. toolExecutor simplifies — no more 6-gate pipeline for MCP-served tools

---

## What This Replaces

| Current | New |
|---------|-----|
| 138+ static tools per agent | 10-12 core + MCP-discovered |
| 17 shared tool files (350+ tools) | 5 MCP servers |
| agent_tool_grants DB table (primary) | Entra ID scopes (primary) + grants (override) |
| toolRegistry.ts KNOWN_TOOLS | MCP server manifests |
| JitToolSelector (from execution flow doc) | MCP servers handle this — agents only get tools from servers they connect to |
| Per-agent tools.ts with 50+ imports | Per-agent tools.ts with core + MCP server list |
| Tool pipeline doc (8 gates) | Reduced to: does agent have MCP scope? → execute |

---

## What This Does NOT Replace

- Agent 365 MCP (already working, keep as-is)
- RuntimeToolFactory (keep as escape hatch)
- Core tools (always loaded, never MCP-served)
- The agent execution flow fixes (JIT context, thinking, model tiering)
- The agent lying fixes (action honesty, verification, receipts)

---

## The Honest Assessment

This is the right architecture. MCP + per-agent identity is how agent platforms
are converging industry-wide. Microsoft built Agent 365 on this exact pattern.
You already adopted it for M365 services.

But it's a multi-week migration, not a weekend project. The static tools work
TODAY — they have the wiring bugs we've documented, but they work. The MCP
migration should happen in parallel with the pipeline fixes, not instead of them.

Priority:
1. Fix the execution flow (JIT tools, thinking, model tiering) — this week
2. Fix the tool pipeline (auto-grant, auto-registry) — this week
3. Extract core tools + build first MCP server — next week
4. Per-agent Entra identity — next week (check license capabilities first)
5. Remaining MCP servers — weeks 3-4
6. Deprecate static tools — week 5

The execution flow fixes (cursor-fix-execution-flow.md) are still needed for the
interim. JitToolSelector caps tools at 64 per call and prevents the 128-cap
catastrophe while you build the MCP servers. Once MCP is live, JitToolSelector
becomes unnecessary because agents only get tools from their connected servers.

---

## Files Created/Modified

| File | Change |
|------|--------|
| packages/agents/src/shared/coreTools.ts | NEW — 10-12 always-loaded core tools |
| packages/agents/src/shared/glyphorMcpTools.ts | NEW — Glyphor MCP server bridge (same pattern as agent365Tools.ts) |
| packages/agents/src/shared/discoverTools.ts | NEW — discover_tools implementation |
| packages/mcp-data-server/ | NEW — mcp_GlyphorData MCP server (Cloud Run) |
| packages/mcp-marketing-server/ | NEW — mcp_GlyphorMarketing MCP server |
| packages/mcp-engineering-server/ | NEW — mcp_GlyphorEngineering MCP server |
| packages/mcp-design-server/ | NEW — mcp_GlyphorDesign MCP server |
| packages/mcp-finance-server/ | NEW — mcp_GlyphorFinance MCP server |
| All agent tools.ts files | Simplify to: core + MCP server connections |
| infra/ | Entra ID per-agent app registrations or managed identities |