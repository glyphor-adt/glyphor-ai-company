# Teams channel posts (#Deliverables, #briefings)

## Message shows as a founder instead of the agent

Channel posts prefer **Agent 365** (`postChannelMessage` with the agent’s **agentic user** Graph token). If that fails, the code falls back in order: **webhook** (bot) → **delegated Graph** (`GRAPH_DELEGATED_REFRESH_TOKEN`) → app-only Graph.

If you see **your** name on the message, the delegated path almost certainly succeeded — the refresh token belongs to your user.

**What to do**

1. **Per-agent identity** — In `packages/agent-runtime/src/config/agentIdentities.json`, set each role’s `entraUserId` (and related fields) to that **agent’s** Entra user, not a founder. Avoid using a single shared `AGENT365_AGENTIC_USER_ID` for every agent if those should be different users.
2. **Webhook** — Set `TEAMS_WEBHOOK_DELIVERABLES` / `TEAMS_WEBHOOK_BRIEFINGS` so a bot can post before the delegated fallback runs.
3. **Logs** — When the delegated path is used after an agent role was supplied, the runtime logs a warning so you can spot misconfiguration.

## @mentions show as plain text (`@Kristina`)

Plain text `@Kristina` is **not** a Teams mention. Graph requires `<at id="0">Display Name</at>` in the HTML body plus a `mentions` array with **Entra object IDs**.

Set:

| Variable | Description |
|----------|-------------|
| `TEAMS_FOUNDER_KRISTINA_AAD_ID` | Kristina’s Entra user **Object ID** |
| `TEAMS_FOUNDER_ANDREW_AAD_ID` | Andrew’s Entra user **Object ID** |
| `TEAMS_FOUNDER_KRISTINA_DISPLAY_NAME` | Optional; default `Kristina Denney` |
| `TEAMS_FOUNDER_ANDREW_DISPLAY_NAME` | Optional; default `Andrew Zwelling` |

Find Object IDs in **Azure Portal → Microsoft Entra ID → Users → user → Object ID**.

If these are unset, the footer stays plain text (same behavior as before).

## URLs not clickable

Bare `https://...` links in the body are now wrapped as HTML `<a href>` when converting markdown to Teams HTML (in addition to `[text](url)` markdown links).
