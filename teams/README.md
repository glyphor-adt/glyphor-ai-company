# Teams App Deployment

## Overview

The `teams/` directory contains the Microsoft Teams app manifest for embedding the Glyphor dashboard and bot into Teams.

## Setup

### 1. Register the Entra ID App

Create an app registration in Azure Entra ID for the Teams bot:

```bash
az ad app create --display-name "Glyphor AI Teams Bot" \
  --sign-in-audience AzureADMyOrg
```

### 2. Create the Bot Registration

```bash
az bot create --resource-group glyphor-resources \
  --name glyphor-teams-bot \
  --app-type SingleTenant \
  --appid <AZURE_CLIENT_ID> \
  --endpoint https://glyphor-scheduler-610179349713.us-central1.run.app/api/teams/messages
```

### 3. Configure the Manifest

Replace placeholders in `manifest.json`:

| Placeholder | Value |
|---|---|
| `{{TEAMS_APP_ID}}` | A new UUID for the Teams app (generate with `uuidgen`) |
| `{{BOT_APP_ID}}` | The Entra ID app registration client ID |
| `{{DASHBOARD_URL}}` | `https://glyphor-dashboard-610179349713.us-central1.run.app` |
| `{{DASHBOARD_DOMAIN}}` | `glyphor-dashboard-610179349713.us-central1.run.app` |
| `{{SCHEDULER_DOMAIN}}` | `glyphor-scheduler-610179349713.us-central1.run.app` |
| `{{AZURE_CLIENT_ID}}` | Same as BOT_APP_ID |

### 4. Add Icons

Place two PNG icons in this directory:

- `icon-color.png` — 192×192 full-color app icon
- `icon-outline.png` — 32×32 transparent outline icon

### 5. Package & Upload

```bash
cd teams
zip -r glyphor-teams.zip manifest.json icon-color.png icon-outline.png
```

Upload the zip to Teams Admin Center → Manage apps → Upload new app.

### 6. Environment Variables

Set these on the scheduler (Cloud Run):

```
BOT_APP_ID=<entra-client-id>
BOT_APP_SECRET=<entra-client-secret>
BOT_TENANT_ID=<entra-tenant-id>
```

## Features

### Static Tabs (Personal App)
- **Dashboard** — Full executive dashboard
- **Agent Chat** — 1:1 chat with any agent
- **Group Chat** — Multi-agent group conversations
- **Approvals** — Decision approval queue

### Configurable Tab (Team/Channel)
- Embeds any dashboard page into a Teams channel tab

### Bot Commands
- `ask [agent] [question]` — Ask any agent a question
- `briefing` — Get today's daily briefing
- `status` — System health check
- `agents` — List all agents and status
