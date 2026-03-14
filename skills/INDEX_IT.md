# IT Team Skills — Implementation Index

## Architecture Reference

These skills are written for the actual Glyphor infrastructure:
- **Compute**: GCP Cloud Run (glyphor-scheduler, glyphor-worker, glyphor-dashboard)
- **Database**: Cloud SQL PostgreSQL — 86 tables, pgvector, `pg` connection pool, 133 migrations
- **Work Queues**: Cloud Tasks (agent-runs, agent-runs-priority, delivery)
- **Triggers**: Cloud Scheduler → Pub/Sub topic `glyphor-agent-tasks` (37 agent crons + 9 data syncs + dynamic)
- **Storage**: GCS (briefings, reports, specs)
- **Secrets**: GCP Secret Manager (25+ secrets, merge-mode deploys)
- **CI/CD**: GitHub Actions → Workload Identity Federation → Artifact Registry → Cloud Run
- **Models**: Default `gpt-5-mini-2025-08-07`, multi-provider (Gemini/OpenAI/Claude)
- **Comms**: Microsoft Teams (9 channels, Bot Framework, 10 agent bots)
- **Identity**: Azure Entra ID (SingleTenant, MSAL)
- **MCP**: 10 Glyphor MCP servers (~87 tools), 8 Agent365 MCP servers
- **Search**: GraphRAG (Python, Gemini extraction, synced to Cloud SQL)

## Agent → Skill Mapping

| Agent | Role | Reports To | Skills |
|-------|------|------------|--------|
| Marcus Reeves | CTO | Sarah Chen | `code-review` (NEW), `incident-response` (v2), `platform-monitoring` (v2), `tech-spec-writing` (v2) |
| Alex Park | Platform Engineer | Marcus Reeves | `platform-monitoring` (v2), `incident-response` (v2) |
| Sam DeLuca | Quality Engineer | Marcus Reeves | `quality-assurance` (NEW), `tech-spec-writing` (v2) |
| Jordan Hayes | DevOps Engineer | Marcus Reeves | `infrastructure-ops` (NEW), `incident-response` (v2), `platform-monitoring` (v2) |
| Ava Chen | Frontend Engineer | Mia Tanaka | `frontend-development` (NEW), `design-system-management` (existing) |
| Riley Morgan | M365 Administrator | Marcus Reeves | `tenant-administration` (NEW) |
| Morgan Blake | Global Administrator | Sarah Chen | `access-management` (NEW) |

## What Changed From the Old Skills

The old skills were 6-line numbered checklists with 2-3 tools_granted. The new skills are 100-155 line playbooks that give each agent:

- **Philosophy** — how to think about the work, not just what steps to follow
- **Glyphor-specific context** — references to the actual infrastructure (Cloud SQL, Cloud Run, Cloud Tasks, 86 tables, 28 agents, GCP Secret Manager, GitHub Actions CI/CD)
- **Anti-patterns** — what bad looks like, so the agent can self-correct
- **Quality loops** — built-in refinement and verification steps
- **Judgment frameworks** — how to make decisions in ambiguous situations
- **Concrete examples** — good vs bad review comments, good vs bad bug reports, etc.
- **Full tool grants** — every tool referenced in the methodology is listed in tools_granted

**Size comparison:**
| Skill | Old | New |
|-------|-----|-----|
| incident-response | 7 lines, 3 tools | 155 lines, 22 tools |
| platform-monitoring | 6 lines, 2 tools | 134 lines, 23 tools |
| tech-spec-writing | 7 lines, 2 tools | 130 lines, 11 tools |
| code-review | (didn't exist) | 119 lines, 11 tools |
| quality-assurance | (didn't exist) | 132 lines, 17 tools |
| infrastructure-ops | (didn't exist) | 116 lines, 27 tools |
| frontend-development | (didn't exist) | 122 lines, 31 tools |
| access-management | (didn't exist) | 101 lines, 20 tools |
| tenant-administration | (didn't exist) | 110 lines, 22 tools |

## Implementation Steps

### Step 1: Update the skills table

For each skill file:

1. Parse the YAML frontmatter for: `slug`, `name`, `category`, `description`, `holders`, `tools_granted`, `version`
2. **Existing skills** (incident-response, platform-monitoring, tech-spec-writing): UPDATE the row, replacing `methodology`, `description`, `tools_granted`, bump `version` to 2
3. **New skills** (code-review, quality-assurance, infrastructure-ops, frontend-development, access-management, tenant-administration): INSERT new row
4. The `methodology` field = everything below the second `---` (the full markdown body)

### Step 2: Update skill_holders junction

Map the `holders` field from frontmatter to the skill-agent assignment table.

### Step 3: Verify injection

1. Trigger a run for each affected agent
2. Confirm `companyAgentRunner.ts:842-844` loads the full methodology into the prompt
3. Verify the agent's behavior reflects the new playbook content
4. Check that all `tools_granted` are available in the agent's effective tool set

## File Inventory

```
skills/
├── engineering/
│   ├── code-review.md          # NEW — CTO
│   ├── incident-response.md    # v2 — CTO, Platform, DevOps, Ops
│   ├── platform-monitoring.md  # v2 — CTO, Platform, DevOps, Ops
│   ├── tech-spec-writing.md    # v2 — CTO, QE
│   ├── quality-assurance.md    # NEW — QE
│   ├── infrastructure-ops.md   # NEW — DevOps
│   └── frontend-development.md # NEW — Frontend Engineer
├── operations/
│   ├── access-management.md    # NEW — Global Admin
│   └── tenant-administration.md # NEW — M365 Admin
└── INDEX.md                    # This file
```
