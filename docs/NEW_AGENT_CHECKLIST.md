# New Agent Checklist

> **Every new agent MUST complete ALL items below before being considered "shipped."**
> No PR should be merged that adds a new agent without every box checked.

---

## Quick Reference

| Step | File / System | What to Add |
|------|---------------|-------------|
| 1 | `agent-runtime/src/types.ts` | `CompanyAgentRole` union + `EXECUTIVE_ROLES` or `SUB_TEAM_ROLES` + `AGENT_BUDGETS` |
| 2 | `agents/src/<role>/systemPrompt.ts` | System prompt with personality, authority tiers, domain areas |
| 3 | `agents/src/<role>/run.ts` | Run function with typed params |
| 4 | `agents/src/index.ts` | Export run fn + system prompt + add to `SYSTEM_PROMPTS` record |
| 5 | `agent-runtime/src/config/agentEmails.ts` | `AGENT_EMAIL_MAP` entry |
| 6 | `agent-runtime/src/subscriptions.ts` | `SUBSCRIPTIONS` entry |
| 7 | `agent-runtime/src/companyAgentRunner.ts` | `ROLE_TO_BRIEF`, `ROLE_DEPARTMENT`, `ROLE_CONTEXT_FILES` |
| 8 | `scheduler/src/server.ts` | Import run fn + add routing branch in `agentExecutor` |
| 9 | `scheduler/src/authorityGates.ts` | `GREEN_ACTIONS` entry |
| 10 | `scheduler/src/inboxCheck.ts` | `EMAIL_ENABLED_AGENTS` (if email-enabled) |
| 11 | `dashboard/src/lib/types.ts` | `AGENT_META`, `DISPLAY_NAME_MAP`, `AGENT_SOUL`, `AGENT_SKILLS`, `ROLE_TIER`, `ROLE_DEPARTMENT`, `ROLE_TITLE` |
| 12 | `dashboard/src/pages/Workforce.tsx` | `TITLE_MAP` + `DEPARTMENTS` (if exec) + grid sort order |
| 13 | `company-knowledge/briefs/<name>.md` | Agent brief file |
| 14 | `scripts/generate-avatars.mjs` | Add to `AGENTS` array, then run script |
| 15 | `supabase/migrations/` | SQL migration (applied via psql to Cloud SQL): `company_agents` + `agent_profiles` |
| 16 | **M365 Exchange** | Create shared mailbox `name@glyphor.ai` |
| 17 | **Build & Deploy** | `npx turbo build --force`, deploy to Cloud Run |

---

## Detailed Steps

### Phase 1: Backend — Agent Runtime & Logic

#### 1. Register the Role Type
**File:** `packages/agent-runtime/src/types.ts`

- [ ] Add role to `CompanyAgentRole` union type (e.g. `| 'clo'`)
- [ ] Add role to `EXECUTIVE_ROLES` array (if executive) or `SUB_TEAM_ROLES` (if sub-team)
- [ ] Add entry to `AGENT_BUDGETS` with per-run, daily, and monthly limits

#### 2. Create Agent Directory
**Directory:** `packages/agents/src/<role>/`

- [ ] Create `systemPrompt.ts` — personality, authority model (GREEN/YELLOW/RED tiers), domain areas
- [ ] Create `run.ts` — run function with typed task union, model selection, tools, maxTurns

#### 3. Export from Agents Package
**File:** `packages/agents/src/index.ts`

- [ ] Export run function: `export { runNewRole, type NewRoleRunParams } from './<role>/run.js';`
- [ ] Import system prompt: `import { NEW_ROLE_SYSTEM_PROMPT } from './<role>/systemPrompt.js';`
- [ ] Add to `SYSTEM_PROMPTS` record: `'<role>': NEW_ROLE_SYSTEM_PROMPT,`

#### 4. Configure Email Identity
**File:** `packages/agent-runtime/src/config/agentEmails.ts`

- [ ] Add to `AGENT_EMAIL_MAP`: `'<role>': { email: '<name>@glyphor.ai', displayName: '<Full Name>', title: '<Title>' }`

#### 5. Configure Event Subscriptions
**File:** `packages/agent-runtime/src/subscriptions.ts`

- [ ] Add to `SUBSCRIPTIONS`: `'<role>': ['event.type1', 'event.type2', ...]`

#### 6. Configure Context Loading
**File:** `packages/agent-runtime/src/companyAgentRunner.ts`

- [ ] Add to `ROLE_TO_BRIEF`: `'<role>': '<firstname-lastname>'`
- [ ] Add to `ROLE_DEPARTMENT`: `'<role>': '<department>'`
- [ ] Add to `ROLE_CONTEXT_FILES`: `'<role>': ['<department>.md']`

### Phase 2: Scheduler — Routing & Authority

#### 7. Add Router Branch
**File:** `packages/scheduler/src/server.ts`

- [ ] Import: `import { runNewRole } from '@glyphor/agents';`
- [ ] Add routing: `else if (agentRole === '<role>') { return runNewRole({...}); }`

#### 8. Define Authority Gates
**File:** `packages/scheduler/src/authorityGates.ts`

- [ ] Add to `GREEN_ACTIONS`: `'<role>': new Set(['on_demand', 'read_inbox', ...])`

#### 9. Enable Email Inbox Polling
**File:** `packages/scheduler/src/inboxCheck.ts`

- [ ] Add role to `EMAIL_ENABLED_AGENTS` array

### Phase 3: Dashboard — Visibility & UI

#### 10. Add Dashboard Metadata
**File:** `packages/dashboard/src/lib/types.ts`

ALL of these are **mandatory**:

- [ ] `AGENT_META`: `'<role>': { color: '#hex', icon: 'MdIconName' }`
- [ ] `DISPLAY_NAME_MAP`: `'<role>': '<Full Name>'`
- [ ] `AGENT_SOUL`: mission, persona, tone, ethics
- [ ] `AGENT_SKILLS`: `'<role>': ['skill1', 'skill2', ...]`
- [ ] `ROLE_TIER`: `'<role>': 'Executive' | 'Sub-Team' | 'Specialist' | 'Orchestrator'`
- [ ] `ROLE_DEPARTMENT`: `'<role>': '<Department Name>'`
- [ ] `ROLE_TITLE`: `'<role>': '<Job Title>'`

#### 11. Add to Org Chart
**File:** `packages/dashboard/src/pages/Workforce.tsx`

- [ ] `TITLE_MAP`: `'<role>': '<Job Title>'` (if executive/specialist)
- [ ] `DEPARTMENTS` array: `{ label: '<Dept>', role: '<role>' }` (if new department head)
- [ ] Grid sort order array: add role in correct position

### Phase 4: Knowledge & Identity

#### 12. Create Agent Brief
**File:** `packages/company-knowledge/briefs/<firstname-lastname>.md`

- [ ] Write the agent's operational brief (context loaded at runtime)

#### 13. Generate Avatar
**File:** `scripts/generate-avatars.mjs`

- [ ] Add entry to `AGENTS` array: `{ role: '<role>', name: '<Full Name>', desc: '<appearance description>' }`
- [ ] Run: `GOOGLE_AI_API_KEY=<key> node scripts/generate-avatars.mjs`
- [ ] Verify: `packages/dashboard/public/avatars/<role>.png` exists

### Phase 5: Database & External Services

#### 14. Create Database Migration
**File:** `supabase/migrations/<YYYYMMDD>HHMMSS_<agent>_agent.sql`

- [ ] `INSERT INTO company_agents` (role, display_name, name, title, model, status, reports_to, is_core)
- [ ] `INSERT INTO agent_profiles` (personality_summary, backstory, communication_traits, quirks, tone_settings, voice_sample, signature, clifton_strengths, voice_examples)
- [ ] Run: `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f supabase/migrations/<migration_file>.sql`

#### 15. Create M365 Shared Mailbox
**PowerShell (Exchange Online):**

```powershell
Connect-ExchangeOnline
New-Mailbox -Shared -Name "<Full Name>" -DisplayName "<Full Name>" -Alias "<firstname>" -PrimarySmtpAddress "<firstname>@glyphor.ai"
```

- [ ] Verify mailbox created in Exchange Admin Center
- [ ] Confirm the Entra app registration has `Mail.Send` + `Mail.ReadWrite` permissions for the new mailbox

### Phase 6: Build, Test & Deploy

#### 16. Build
```bash
npx turbo build --force
```
- [ ] All packages compile clean (agent-runtime, agents, scheduler, dashboard)

#### 17. Deploy
```bash
gcloud builds submit --config=cloudbuild-temp.yaml
gcloud run deploy glyphor-scheduler --image=<image> --region=us-central1
```
- [ ] Cloud Run revision is live and healthy
- [ ] New agent appears on dashboard org chart
- [ ] Agent avatar loads correctly
- [ ] Agent can send/receive email

---

## Template: Agent Identity Card

Fill this out before starting implementation:

```
Role slug:        _______________  (e.g. 'clo')
Full name:        _______________  (e.g. 'Victoria Chase')
Job title:        _______________  (e.g. 'Chief Legal Officer')
Department:       _______________  (e.g. 'Legal')
Reports to:       _______________  (e.g. null for exec, 'cto' for sub-team)
Tier:             _______________  (Executive / Sub-Team / Specialist)  
Email:            _______________@glyphor.ai
Color (hex):      _______________  (e.g. '#6D28D9')
Icon:             _______________  (Material Design icon, e.g. 'MdGavel')
Model:            _______________  (e.g. 'gemini-3-flash-preview')
Avatar desc:      _______________  (physical appearance for Imagen)
Budget (per-run): $_______________
Budget (daily):   $_______________
Budget (monthly): $_______________
```

---

## Common Mistakes

| Mistake | Consequence |
|---------|-------------|
| Forgetting `AGENT_META` in types.ts | Agent card renders with no color or icon |
| Forgetting `DISPLAY_NAME_MAP` | Agent shows role slug instead of human name |
| Forgetting `AGENT_SOUL` | Agent detail page shows empty persona section |
| Forgetting avatar generation | Broken image on org chart and agent cards |
| Forgetting `TITLE_MAP` in Workforce.tsx | Agent shows role slug as title on org chart |
| Forgetting `DEPARTMENTS` in Workforce.tsx | Executive agent doesn't appear on org chart at all |
| Forgetting `AGENT_SKILLS` | Empty capabilities section on agent profile |
| Forgetting agent brief .md file | Agent runtime loads empty context |
| Forgetting M365 mailbox | Email send/receive fails silently |
| Forgetting `EMAIL_ENABLED_AGENTS` | Agent never polls inbox even if mailbox exists |
| Forgetting database migration | Agent doesn't appear in database queries |
