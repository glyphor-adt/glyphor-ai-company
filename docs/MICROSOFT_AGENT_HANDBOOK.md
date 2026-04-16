# Microsoft Agent Handbook

This repo already supports a Microsoft-first agent setup. Use this path when you want to show someone how to build and operate one agent with Entra ID, Agent365, Microsoft Graph, and Teams only.

## What the agent uses

- Entra ID for identity and permissions
- Agent365 for MCP access to Microsoft services
- Microsoft Teams for human-facing interaction
- Microsoft Graph for mail, calendar, files, and mentions
- Shared mailbox in Exchange Online for the agent address

## What it does not use

- Slack
- Slack OAuth
- Slack app home tabs
- Slack DMs or channels

## Minimum build path

1. Pick the role slug and identity record.
2. Create the Entra app registration and service principal for the agent.
3. Create the Agent365 blueprint binding and agentic user.
4. Add the agent identity to `packages/agent-runtime/src/config/agentIdentities.json`.
5. Add the email mapping to `packages/agent-runtime/src/config/agentEmails.ts`.
6. Create or verify the shared mailbox in Exchange Online.
7. Add the agent brief in `packages/company-knowledge/briefs/`.
8. Add the role to the runtime, scheduler, and dashboard registries.
9. Run `scripts/validate-agent365-setup.ts`.
10. Build and deploy.

## Identity records that matter

The runtime expects each agent to have these Microsoft-linked values:

- `appId`
- `spId`
- `blueprintSpId`
- `entraUserId`
- `upn`

The canonical source is [packages/agent-runtime/src/config/agentIdentities.json](../packages/agent-runtime/src/config/agentIdentities.json).

## Agent365 setup

Agent365 is the Microsoft MCP bridge used by the agents. The bridge code is in [packages/agents/src/shared/agent365Tools.ts](../packages/agents/src/shared/agent365Tools.ts).

The main points:

- `AGENT365_ENABLED=true` turns the bridge on
- `AGENT365_CLIENT_ID`, `AGENT365_CLIENT_SECRET`, and `AGENT365_TENANT_ID` are required
- `AGENT365_APP_INSTANCE_ID` and `AGENT365_AGENTIC_USER_ID` are required for the agent identity
- `AGENT365_BLUEPRINT_ID` links the blueprint app instance

## Teams and Graph behavior

The current platform uses Teams and Graph as the user-facing Microsoft surfaces. For a new agent, the typical path is:

- Teams message or DM arrives
- Scheduler routes the task to the agent runtime
- Agent365 tools are loaded if enabled
- The agent responds through Teams or Graph-backed workflows

## Validation

Use the Microsoft setup checker after wiring a new agent:

```bash
node scripts/validate-agent365-setup.ts --strict-env
```

This checks:

- identity coverage
- email map coverage
- blueprint and Entra user IDs
- manifest coverage
- Agent365 environment variables
- MailTools availability in ToolingManifest

## New agent checklist

If you are adding a brand-new agent, follow [docs/NEW_AGENT_CHECKLIST.md](NEW_AGENT_CHECKLIST.md). The Microsoft-specific items to emphasize are:

- Entra app registration and service principal
- Agent365 identity wiring
- Exchange shared mailbox
- Teams/Graph routing
- No Slack dependencies

## Recommended demo script

1. Show the agent identity in Entra ID.
2. Show the entry in `agentIdentities.json`.
3. Show the Agent365 bridge and validation script.
4. Show the agent brief and runtime routing.
5. Send a Teams message to the agent and show the response path.

## If you need a one-line summary

This platform builds an agent as a Microsoft identity-backed workload: Entra ID for auth, Agent365 for tools, Teams for interaction, and Graph for enterprise integration.