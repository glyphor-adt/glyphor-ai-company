# Agent 365 MCP Tooling Audit & Cleanup

> Objective: Ensure every Glyphor agent has access to the full Agent 365 MCP server catalog, remove unnecessary server filters, fix missing Entra permission grants, add missing servers to the manifest, and resolve overlap between Glyphor-built MCP servers and Microsoft-hosted equivalents.

---

## Current State Summary

### What's registered in ToolingManifest.json (6 Microsoft servers)

| Server ID | Scope | Status | Description |
|-----------|-------|--------|-------------|
| `mcp_MailTools` | `McpServers.Mail.All` | Registered, **scope NOT granted** | Outlook email: send, read, search (KQL), reply, draft |
| `mcp_CalendarTools` | `McpServers.Calendar.All` | Registered, scope granted | Calendar: CRUD events, accept/decline, find free/busy |
| `mcp_ODSPRemoteServer` | `McpServers.OneDriveSharepoint.All` | Registered, **scope NOT granted** | SharePoint/OneDrive: upload, search, folders, metadata, sensitivity labels |
| `mcp_TeamsServer` | `McpServers.Teams.All` | Registered, scope granted | Teams: chat CRUD, post messages, channel management, member management |
| `mcp_M365Copilot` | `McpServers.CopilotMCP.All` | Registered, scope granted | M365 Copilot: multi-turn chat, file-grounded search across all M365 data |
| `mcp_WordServer` | `McpServers.Word.All` | Registered, **scope NOT granted** | Word: create/read documents, add/reply to comments |

### What's NOT registered but available in the Agent 365 catalog

| Server ID | Scope | Status | Description |
|-----------|-------|--------|-------------|
| `mcp_UserProfile` | `McpServers.UserProfile.All` | **Missing from manifest** | User profiles: get manager, direct reports, search users, org hierarchy |
| `mcp_SharePointLists` | `McpServers.SharePointLists.All` | **Missing from manifest** | SharePoint Lists: CRUD on lists, columns, items; query with filters and pagination |
| `mcp_AdminCenter` | `McpServers.AdminCenter.All` | **Missing from manifest** | M365 Admin: license management, user provisioning, tenant health (Frontier only) |

### What Entra scopes are actually granted to agent identity SPs

Only 3 out of 6+ available scopes are assigned via `oauth2PermissionGrants`:

```
✅ McpServers.Calendar.All    — granted to all 44 agent identity SPs
✅ McpServers.Teams.All        — granted to all 44 agent identity SPs
✅ McpServers.CopilotMCP.All   — granted to all 44 agent identity SPs
❌ McpServers.Mail.All         — NOT GRANTED (agents cannot use mcp_MailTools)
❌ McpServers.OneDriveSharepoint.All — NOT GRANTED (agents cannot use mcp_ODSPRemoteServer)
❌ McpServers.Word.All         — NOT GRANTED (agents cannot use mcp_WordServer)
❌ McpServers.UserProfile.All  — NOT GRANTED (server not even in manifest)
❌ McpServers.SharePointLists.All — NOT GRANTED (server not even in manifest)
```

This means even if you remove the server filter in code, agents will get 403s from Mail, SharePoint/OneDrive, and Word because the Entra permissions haven't been consented.

### Which agents have Agent 365 wired at all (~25 of 44)

**Have Agent 365 tools:**
- C-Suite: chief-of-staff, cto, cfo, cmo, cpo, clo (6)
- Ops/Admin: ops, global-admin, m365-admin (3)
- Research: vp-research, 5 research analysts, competitive-intel, account-research, cost-analyst, org-analyst (10)
- Design: ui-ux-designer, design-critic, vp-design, template-architect (4)
- Other: vp-sales, content-creator, devops-engineer (3)
- Dynamic agents via runDynamicAgent.ts (7 specialists)

**Do NOT have Agent 365 tools (~11 agents):**
- vp-customer-success (James Turner)
- seo-analyst (Lisa Chen)
- social-media-manager (Kai Johnson)
- user-researcher (Priya Sharma)
- revenue-analyst (Anna Park)
- onboarding-specialist (Emma Wright)
- support-triage (David Santos)
- platform-engineer (Alex Park)
- quality-engineer (Sam DeLuca)
- head-of-hr (Jasmine Rivera)
- frontend-engineer (Ava Chen)

### Server filter problem

Even among the ~25 agents that have Agent 365 wired, most hard-filter to:

```typescript
['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']
```

This means agents with Agent 365 wiring still cannot access Mail, SharePoint/OneDrive, or Word tools — even once the Entra scopes are granted.

---

## Three Problems To Fix

### Problem 1: Missing Entra permission grants

Three servers are registered in the manifest but agents don't have the Entra scopes to use them. Three more servers aren't even registered.

### Problem 2: Server filter in agent runners

Most agent runners pass a 3-server filter array to `createAgent365McpTools()`, blocking access to the other registered servers.

### Problem 3: 11 agents have no Agent 365 wiring at all

These agents have no `createAgent365McpTools()` call in their runner, so they have zero M365 MCP tools regardless of permissions or filters.

---

## Fix 1: Grant Missing Entra Scopes

### Script update: `scripts/assign-agent-permissions.ps1`

Add the missing scopes to the oauth2PermissionGrant block that runs against every agent identity SP. The target resource is the M365 Agent Tools API (`ea9ffc3e-...`).

**Scopes to add:**

```
McpServers.Mail.All
McpServers.OneDriveSharepoint.All
McpServers.Word.All
McpServers.UserProfile.All
McpServers.SharePointLists.All
```

**Updated grant should include all 8 scopes:**

```powershell
$allMcpScopes = @(
    "McpServers.Calendar.All",
    "McpServers.Teams.All",
    "McpServers.CopilotMCP.All",
    "McpServers.Mail.All",
    "McpServers.OneDriveSharepoint.All",
    "McpServers.Word.All",
    "McpServers.UserProfile.All",
    "McpServers.SharePointLists.All"
) -join " "

# For each agent identity SP:
$grantParams = @{
    clientId    = $agentSpId
    consentType = "AllPrincipals"
    resourceId  = $m365AgentToolsSpId  # ea9ffc3e-...
    scope       = $allMcpScopes
    expiryTime  = (Get-Date).AddYears(2).ToString("o")
}

# Update existing grant or create new one
# If grant already exists, PATCH with expanded scope string
# If new, POST to /oauth2PermissionGrants
```

Run this once for all 44 agent identity SPs. The grant is `consentType: AllPrincipals` so it applies tenant-wide per SP.

**Verification after running:**

```powershell
# For each agent SP, confirm scope string includes all 8:
Get-MgOauth2PermissionGrant -Filter "clientId eq '$agentSpId'" |
    Select-Object Scope
```

---

## Fix 2: Update ToolingManifest.json

Add the 3 missing servers to the manifest. The manifest lives at `ToolingManifest.json` in the repo root.

**Servers to add:**

```json
{
  "id": "mcp_UserProfile",
  "name": "Microsoft 365 User Profile MCP Server",
  "url": "https://agent365.svc.cloud.microsoft/mcp/{environment}/servers/UserProfile",
  "scope": "McpServers.UserProfile.All",
  "description": "User profiles, manager chain, direct reports, user search"
},
{
  "id": "mcp_SharePointLists",
  "name": "Microsoft SharePoint Lists MCP Server",
  "url": "https://agent365.svc.cloud.microsoft/mcp/{environment}/servers/SharePointLists",
  "scope": "McpServers.SharePointLists.All",
  "description": "SharePoint Lists CRUD: lists, columns, items, filtered queries"
},
{
  "id": "mcp_AdminCenter",
  "name": "Microsoft 365 Admin Center MCP Server",
  "url": "https://agent365.svc.cloud.microsoft/mcp/{environment}/servers/AdminCenter",
  "scope": "McpServers.AdminCenter.All",
  "description": "M365 admin operations: licenses, users, tenant health"
}
```

Note: Confirm the exact server URLs by checking the Agent 365 SDK discovery endpoint or the M365 admin center Tools page. The URL pattern above follows the convention from the existing manifest entries.

After adding, total Microsoft MCP servers in manifest: 9.
Total MCP servers in manifest (Microsoft + Glyphor): 18.

---

## Fix 3: Remove Server Filters — Give Every Agent Everything

### 3a. Create a shared constant

**File:** `packages/agents/src/shared/agent365Tools.ts`

Replace the per-agent filter arrays with a single shared constant:

```typescript
/**
 * All Microsoft Agent 365 MCP servers.
 * Every agent gets access to the full catalog.
 * Access control is handled by Entra scopes + authority tiers,
 * not by filtering which servers an agent can see.
 */
export const ALL_M365_SERVERS = [
  'mcp_MailTools',
  'mcp_CalendarTools',
  'mcp_ODSPRemoteServer',
  'mcp_TeamsServer',
  'mcp_M365Copilot',
  'mcp_WordServer',
  'mcp_UserProfile',
  'mcp_SharePointLists',
  'mcp_AdminCenter',
];
```

### 3b. Update createAgent365McpTools call signature

If `createAgent365McpTools()` currently requires a filter parameter, update the default:

**File:** `packages/agents/src/shared/agent365Tools.ts` (or wherever `createAgent365McpTools` is defined)

```typescript
// Before:
export async function createAgent365McpTools(serverFilter?: string[]) {
  // ... discovers only servers in serverFilter
}

// After:
export async function createAgent365McpTools(serverFilter: string[] = ALL_M365_SERVERS) {
  // ... defaults to all servers when no filter provided
}
```

### 3c. Update every agent runner that passes a filter

These are the files that currently pass `['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']` or a similar subset. Change them to pass no argument (uses the new default) or pass `ALL_M365_SERVERS` explicitly.

**Files to update (agents that currently have Agent 365 with a filter):**

```
packages/agents/src/chief-of-staff/run.ts
packages/agents/src/cto/run.ts
packages/agents/src/cfo/run.ts
packages/agents/src/cmo/run.ts
packages/agents/src/cpo/run.ts
packages/agents/src/clo/run.ts
packages/agents/src/ops/run.ts
packages/agents/src/global-admin/run.ts
packages/agents/src/m365-admin/run.ts
packages/agents/src/vp-research/run.ts
packages/agents/src/vp-sales/run.ts
packages/agents/src/vp-design/run.ts
packages/agents/src/ui-ux-designer/run.ts
packages/agents/src/design-critic/run.ts
packages/agents/src/template-architect/run.ts
packages/agents/src/content-creator/run.ts
packages/agents/src/devops-engineer/run.ts
packages/agents/src/competitive-research-analyst/run.ts
packages/agents/src/market-research-analyst/run.ts
packages/agents/src/technical-research-analyst/run.ts
packages/agents/src/industry-research-analyst/run.ts
packages/agents/src/ai-impact-analyst/run.ts
packages/agents/src/org-analyst/run.ts
packages/agents/src/account-research/run.ts
packages/agents/src/cost-analyst/run.ts
```

**Change in each file:**

```typescript
// Before:
const agent365Tools = await createAgent365McpTools([
  'mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot'
]);

// After:
const agent365Tools = await createAgent365McpTools();
```

One find-and-replace pattern across the codebase:

```
Find:    createAgent365McpTools([
Replace: createAgent365McpTools(
```

Then delete the array argument and closing bracket. Or simply search for all instances of `createAgent365McpTools(` and remove any argument.

---

## Fix 4: Wire Agent 365 to the 11 Missing Agents

These agents have runner files but no `createAgent365McpTools()` call. Add it.

**Files to update:**

```
packages/agents/src/vp-customer-success/run.ts    (James Turner)
packages/agents/src/seo-analyst/run.ts             (Lisa Chen)
packages/agents/src/social-media-manager/run.ts    (Kai Johnson)
packages/agents/src/user-researcher/run.ts         (Priya Sharma)
packages/agents/src/revenue-analyst/run.ts         (Anna Park)
packages/agents/src/onboarding-specialist/run.ts   (Emma Wright)
packages/agents/src/support-triage/run.ts          (David Santos)
packages/agents/src/platform-engineer/run.ts       (Alex Park)
packages/agents/src/quality-engineer/run.ts        (Sam DeLuca)
packages/agents/src/head-of-hr/run.ts              (Jasmine Rivera)
packages/agents/src/frontend-engineer/run.ts       (Ava Chen)
```

**Pattern to add in each runner's tool setup section:**

```typescript
import { createAgent365McpTools } from '../shared/agent365Tools';

// In the tool loading section, alongside existing tool creation:
const agent365Tools = await createAgent365McpTools();

// Add to the tools array passed to the agent:
const allTools = [
  ...existingTools,
  ...agent365Tools,
];
```

Follow the same pattern used in the existing 25 agents that already have it wired. Each runner has a section where tools are assembled before being passed to `createAgent()` or the executor — add `agent365Tools` there.

### Dynamic agents (runDynamicAgent.ts)

Confirm that `runDynamicAgent.ts` already calls `createAgent365McpTools()` without a filter. If it passes a filter, remove it. All 7 specialist agents (Ethan, Bob, Grace, Mariana, Derek, Zara, Adi) run through this path.

---

## Fix 5: Resolve Overlap Between Glyphor MCP Servers and Agent 365 Servers

There are functional overlaps between your 9 Glyphor-built MCP servers and the Microsoft-hosted Agent 365 servers. This doesn't need to be resolved immediately, but the overlap should be documented so agents (and you) know which tool to use when.

### Email overlap

| Capability | Glyphor `mcp-email-server` | Agent 365 `mcp_MailTools` |
|-----------|---------------------------|--------------------------|
| Send email | ✅ `send_email` (plain-text enforced) | ✅ `createMessage` (HTML supported) |
| Read inbox | ✅ `read_inbox` | ✅ `listMessages`, `getMessage` |
| Reply | ✅ `reply_to_email` | ✅ `replyToMessage`, `replyAllToMessage` |
| KQL search | ❌ | ✅ `searchMessages` |
| Draft management | ❌ | ✅ `createDraft`, `updateMessage`, `deleteMessage` |
| Folder management | ❌ | ✅ `listMailFolders` |

**Recommendation:** Keep Glyphor's `mcp-email-server` as the primary outbound email tool — it enforces plain-text which is what you want for external communications. Use Agent 365 `mcp_MailTools` for inbound email search (KQL), reading specific messages, and draft management. No need to deprecate either. Agents will naturally use whichever tool name matches their task. Add a brief note in agent briefs: "For sending outbound email, use `send_email`. For searching or reading inbound email, use the M365 mail tools."

### SharePoint overlap

| Capability | Glyphor `sharepointTools.ts` | Agent 365 `mcp_ODSPRemoteServer` |
|-----------|------------------------------|----------------------------------|
| List files | ✅ `list_sharepoint_files` | ✅ `listDriveItems`, `searchFiles` |
| Upload files | ❌ | ✅ `uploadFile` |
| Create folders | ❌ | ✅ `createFolder` |
| Create pages | ❌ | ✅ (via site pages API) |
| Get file content | ❌ | ✅ `getFileContent` |
| Sensitivity labels | ❌ | ✅ `setSensitivityLabel` |

**Recommendation:** Deprecate the Glyphor `list_sharepoint_files` tool. Agent 365's SharePoint server is strictly superior — it can read AND write. The Glyphor tool is read-only and uses Graph API directly, which the Agent 365 server wraps with better error handling and governance.

### Teams overlap

| Capability | Glyphor `directMessages.ts` + `bot.ts` | Agent 365 `mcp_TeamsServer` |
|-----------|----------------------------------------|----------------------------|
| Post to channel | ✅ via Graph API | ✅ `postChannelMessage`, `replyToChannelMessage` |
| Send 1:1 DM | ✅ via Bot Framework (currently broken) | ✅ `createChat` + `postMessage` |
| Create channels | ❌ | ✅ `createChannel`, `createPrivateChannel` |
| List/read messages | ❌ | ✅ `listChatMessages`, `listChannelMessages` |
| Manage members | ❌ | ✅ `addChatMember`, `addChannelMember` |

**Recommendation:** The Agent 365 Teams server can potentially replace parts of your Bot Framework DM sender for agent-to-agent or agent-to-channel communication. However, for founder DMs, the Bot Framework path is still needed because it supports proactive messaging with Adaptive Cards (briefings, decisions, alerts). The Agent 365 Teams server sends plain-text messages through Graph, which doesn't support the rich card format your briefing/decision flows depend on. Keep both paths. Use Agent 365 Teams server for new capabilities (channel creation, member management, reading messages). Keep Bot Framework for Adaptive Card delivery to founders.

### No overlap (Glyphor-only capabilities)

These Glyphor MCP servers have no Agent 365 equivalent and should stay as-is:

| Glyphor Server | Tools | Why no overlap |
|---------------|-------|---------------|
| `glyphor_data` | 12 SQL query tools | Internal DB — Microsoft has no access |
| `glyphor_marketing` | 7 social/SEO tools | Google Search Console, social platforms |
| `glyphor_engineering` | 5 GitHub/Vercel tools | Non-Microsoft infra |
| `glyphor_design` | 5 Playwright/Figma tools | Non-Microsoft design tools |
| `glyphor_finance` | 7 Stripe/Mercury/GCP billing | Non-Microsoft finance platforms |
| `glyphor_legal` | 19 compliance/contract tools | Internal legal DB |
| `glyphor_hr` | 8 org/performance tools | Internal HR DB |
| `glyphor_email_marketing` | 15 Mailchimp/Mandrill tools | Non-Microsoft email marketing |

---

## Execution Checklist

### Phase 1: Entra permissions (do first — nothing else works without this)

```
[ ] Update assign-agent-permissions.ps1 with all 8 MCP scopes
[ ] Run against all 44 agent identity SPs
[ ] Verify: Get-MgOauth2PermissionGrant shows all 8 scopes per SP
[ ] Test: manually invoke one tool from each newly-granted server to confirm no 403
```

### Phase 2: Manifest update

```
[ ] Add mcp_UserProfile to ToolingManifest.json
[ ] Add mcp_SharePointLists to ToolingManifest.json
[ ] Add mcp_AdminCenter to ToolingManifest.json
[ ] Verify manifest has 9 Microsoft + 9 Glyphor = 18 total servers
[ ] Commit manifest change
```

### Phase 3: Remove server filters

```
[ ] Create ALL_M365_SERVERS constant in agent365Tools.ts
[ ] Update createAgent365McpTools default parameter
[ ] Find-and-replace all filtered calls across 25 agent runners
[ ] Verify: grep for createAgent365McpTools\([ should return 0 results (no filtered calls)
```

### Phase 4: Wire missing agents

```
[ ] Add createAgent365McpTools() to vp-customer-success/run.ts
[ ] Add createAgent365McpTools() to seo-analyst/run.ts
[ ] Add createAgent365McpTools() to social-media-manager/run.ts
[ ] Add createAgent365McpTools() to user-researcher/run.ts
[ ] Add createAgent365McpTools() to revenue-analyst/run.ts
[ ] Add createAgent365McpTools() to onboarding-specialist/run.ts
[ ] Add createAgent365McpTools() to support-triage/run.ts
[ ] Add createAgent365McpTools() to platform-engineer/run.ts
[ ] Add createAgent365McpTools() to quality-engineer/run.ts
[ ] Add createAgent365McpTools() to head-of-hr/run.ts
[ ] Add createAgent365McpTools() to frontend-engineer/run.ts
[ ] Verify runDynamicAgent.ts calls createAgent365McpTools() with no filter
```

### Phase 5: Deploy and verify

```
[ ] Build: npx turbo build
[ ] Deploy scheduler with updated image
[ ] Smoke test: send each agent a task that requires a newly-available tool:
    - "Check my calendar for tomorrow" (Calendar — already working)
    - "Search my inbox for messages about Pulse" (Mail — newly granted)
    - "Upload this document to the Brand Assets folder in SharePoint" (ODSP — newly granted)
    - "Create a Word document with our brand guidelines" (Word — newly granted)
    - "Who is Kristina's manager in the org?" (UserProfile — newly added)
    - "Post a message in #engineering" (Teams — already working)
    - "Search our SharePoint for the operating doctrine" (Copilot — already working)
[ ] Monitor agent_runs for 403 errors from any M365 MCP server
[ ] Monitor cost impact — more tools available = potentially more tool calls per run
```

### Phase 6: Update ARCHITECTURE.md

```
[ ] Update "MCP Servers (6 active)" → "MCP Servers (9 active)"
[ ] Update "Agents using Agent 365 tools (~25)" → "Agents using Agent 365 tools (44 — all agents)"
[ ] Update "Most agents filter to ['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']"
    → "All agents receive the full M365 MCP server catalog (9 servers). Access control is
       handled by Entra scopes and the authority tier system, not server filters."
[ ] Update "M365 MCP scopes assigned to all agents" section to list all 8 scopes
[ ] Add UserProfile, SharePointLists, AdminCenter to the MCP Servers table
[ ] Document the overlap decisions (email, SharePoint, Teams) in a new "Tool Overlap" section
```

---

## After This Cleanup: What Every Agent Has

| Tool Layer | Count | Source |
|-----------|-------|--------|
| Core tools (always loaded) | 11 | coreTools.ts — assignments, comms, memory, events, tool requests |
| Agent 365 M365 MCP tools | ~60+ | 9 Microsoft MCP servers via Agent 365 bridge |
| Glyphor MCP tools | ~81 | 9 Glyphor MCP servers (data, marketing, engineering, design, finance, email, legal, HR, email marketing) |
| Role-specific inline tools | varies | contentTools, seoTools, socialMediaTools, etc. (per agent role) |
| Dynamic tools | varies | tool_registry DB + runtime tool synthesis |
| Research tools | 3 | web_search, web_fetch, submit_research_packet |

Total tools available per agent: **150-200+** depending on role-specific tools.

Access control for what agents can actually DO with these tools is handled by:
- Entra scopes (which M365 operations are consented)
- Authority tiers (green/yellow/red per action type)
- Trust scoring (demotes tier if trust drops)
- Constitutional governance (evaluates output compliance)
- Budget caps (per-run, daily, monthly cost limits)
- Rate limits (DMs, meetings, events per hour/day)
