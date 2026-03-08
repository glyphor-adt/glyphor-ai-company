# Agent 365 MCP Tooling Audit

> Status after the manifest / permissions / runtime cleanup. This document separates what is already complete in the repo from the remaining tenant-side rollout an operator still has to execute.

---

## Status at a Glance

### Complete in the repository

| Area | Current state | Evidence |
|------|---------------|----------|
| Manifest | `ToolingManifest.json` now registers the full 9-server Microsoft Agent 365 catalog. The checked-in manifest currently contains 14 total entries: 9 Microsoft servers + 5 Glyphor servers. | `ToolingManifest.json` |
| Runtime defaults | `createAgent365McpTools()` now defaults to `ALL_M365_SERVERS`, so the full supported Agent 365 catalog is loaded unless a caller explicitly narrows it. No checked-in runner does that anymore. | `packages/agents/src/shared/agent365Tools.ts` |
| Agent wiring | All 37 file-based `run.ts` runners call `createAgent365McpTools('<role>')`, and `runDynamicAgent.ts` does the same for DB-defined specialist agents. There is no longer a repo-side “missing Agent 365 wiring” list to work through. | `packages/agents/src/**/run.ts`, `packages/agents/src/shared/runDynamicAgent.ts` |
| Permission script | `scripts/assign-agent-permissions.ps1` now ensures one `oauth2PermissionGrant` per Agent Identity is created or updated to contain the full 9-scope Microsoft MCP catalog. | `scripts/assign-agent-permissions.ps1` |

### Still requires an operator outside this repo

1. **Run `scripts/assign-agent-permissions.ps1` against the live tenant** using an operator account that can grant the required Microsoft Graph permissions and admin consent. The script is intended to upsert each Agent Identity grant to the full 9-scope set.
2. **Verify the updated `oauth2PermissionGrants` on the existing Agent Identity service principals** in Entra.
3. **Smoke-test the newly opened servers in a live environment** (for example Mail, ODSP/SharePoint, Word, UserProfile, SharePoint Lists, Admin Center) to confirm the identities no longer receive 403 responses.

> The repository is ready for the expanded catalog, but the **Entra grant rollout is still an external operational step**. It cannot be completed from this repository alone.

---

## Current Agent 365 Server Catalog

`packages/agents/src/shared/agent365Tools.ts` now defines two layers:

- `STANDARD_M365_SERVERS` = 6 servers already called out by the smoke-check comments
- `ALL_M365_SERVERS` = those 6 servers plus 3 newly added catalog entries

| Server | Scope | In manifest | Default-loaded by runtime | Notes |
|--------|-------|-------------|---------------------------|-------|
| `mcp_MailTools` | `McpServers.Mail.All` | Yes | Yes | Outlook mail operations, including richer mailbox workflows than the native shared-mailbox helpers |
| `mcp_CalendarTools` | `McpServers.Calendar.All` | Yes | Yes | Calendar CRUD, scheduling, free/busy |
| `mcp_ODSPRemoteServer` | `McpServers.OneDriveSharepoint.All` | Yes | Yes | OneDrive / SharePoint file access |
| `mcp_TeamsServer` | `McpServers.Teams.All` | Yes | Yes | Teams chat, channel, and membership operations |
| `mcp_M365Copilot` | `McpServers.CopilotMCP.All` | Yes | Yes | Microsoft 365 Copilot queries |
| `mcp_WordServer` | `McpServers.Word.All` | Yes | Yes | Word document create/read/comment workflows |
| `mcp_UserProfile` | `McpServers.UserProfile.All` | Yes | Yes | Org graph, managers, direct reports, user lookup |
| `mcp_SharePointLists` | `McpServers.SharePointLists.All` | Yes | Yes | SharePoint list CRUD and querying |
| `mcp_AdminCenter` | `McpServers.AdminCenter.All` | Yes | Yes | Admin-center level tenant operations exposed by Agent 365 |

---

## Current Runtime Behavior

### Factory defaults

`createAgent365McpTools(agentRoleOrServerFilter?, maybeServerFilter?)` behaves as follows:

- Returns `[]` unless `AGENT365_ENABLED='true'`
- Returns `[]` if the required Agent 365 credentials are unavailable
- Resolves the active server list to `ALL_M365_SERVERS` when callers do not pass a filter
- Uses per-agent credential overrides when fully configured, otherwise falls back to the shared Agent 365 client credentials

### Credential resolution

The runtime prefers:

1. `AGENT365_<ROLE>_CLIENT_ID`
2. `AGENT365_<ROLE>_CLIENT_SECRET`
3. `AGENT365_<ROLE>_TENANT_ID` (or shared tenant)
4. `getAgentIdentityAppId(role)` as the role-specific client ID when available

If that per-agent setup is incomplete, the factory falls back to the shared values:

- `AGENT365_CLIENT_ID`
- `AGENT365_CLIENT_SECRET`
- `AGENT365_TENANT_ID`

### Agent coverage

Repo-side coverage is now uniform:

- **All checked-in file-based runners** load Agent 365 via `createAgent365McpTools('<role>')`
- **Dynamic specialist agents** also load Agent 365 via `createAgent365McpTools(role)` in `runDynamicAgent.ts`
- **No checked-in runner passes a narrowed server filter**, so the runtime cleanup is effectively complete in code

---

## Manifest Notes That Matter for Documentation

The current checked-in manifest is **not** the same thing as every server the bridge code could theoretically load.

### Checked into `ToolingManifest.json` today

- 9 Microsoft Agent 365 servers
- 5 Glyphor MCP servers (`Data`, `Marketing`, `Engineering`, `Design`, `Finance`)
- **14 total manifest entries**

### Supported by code but not currently checked into the manifest

`packages/agents/src/shared/glyphorMcpTools.ts` can also load these env-configured Glyphor MCP servers when URLs are provided:

- `mcp_GlyphorEmail`
- `mcp_GlyphorLegal`
- `mcp_GlyphorHR`
- `mcp_GlyphorEmailMarketing`

That means older documentation that says the manifest already contains 18 entries or 9 Glyphor entries is no longer accurate for the current checked-in file.

---

## Overlap Guidance (Current Implementation)

The cleanup did **not** remove Glyphor-native integrations. Agents now have a broader Microsoft catalog available, but the native paths still matter.

### Email

**Keep the native email tools as the primary Glyphor workflow path.**

- `createCoreTools()` still provides the existing shared-mailbox email tools (`send_email`, inbox/reply helpers)
- Those tools are wired around Glyphor's mailbox model and existing operational flows
- `mcp_MailTools` is additive: use it when the task needs Microsoft-hosted mail capabilities such as broader mailbox search, Outlook-native workflows, or draft-oriented operations

**Documentation rule:** describe Agent 365 Mail as an expansion of capability, not as a replacement for the existing email toolchain.

### SharePoint / OneDrive

**Keep the native SharePoint tools as the primary knowledge-site path.**

- `createSharePointTools()` is still part of the standard shared tool set
- Background ingestion and the curated knowledge/document workflows still depend on the existing SharePoint integration
- Agent 365 ODSP + SharePoint Lists are best documented as the broader M365 file/list surface area beyond the curated native SharePoint path

**Documentation rule:** do not claim the native SharePoint tools are deprecated. The codebase still intentionally ships both paths.

### Teams

**Keep Bot Framework / adaptive-card delivery as the primary founder-notification path.**

- Founder briefings, decision cards, and rich notification flows still rely on the existing Teams/Bot Framework integration
- Agent 365 Teams is appropriate for plain-text Teams chat/channel/member operations and for fallback/expansion scenarios
- It should not be documented as a replacement for Adaptive Card delivery

**Documentation rule:** position Agent 365 Teams as complementary to, not a substitute for, the current Teams notification stack.

---

## Operator Rollout Checklist

Use this checklist outside the repo after merging the code-side cleanup:

- [ ] Run `pwsh scripts/assign-agent-permissions.ps1` with the required Graph admin permissions
- [ ] Confirm each Agent Identity service principal has the expanded 9-scope `oauth2PermissionGrant`
- [ ] Validate one real tool call from each newly opened server family
- [ ] Monitor live runs for residual 403s or authority-tier mismatches

Until those steps are complete, the documentation should treat the **repo cleanup as complete** and the **Entra grant rollout as still pending operational work**.
