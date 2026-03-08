## Governance Page: Current State Review

This document describes what the Governance page currently is in the dashboard today so you can review the existing surface before deciding what to overhaul.

It is not a proposal document. It is an inventory of the page as implemented.

## Where It Lives

- Dashboard route: `/governance`
- Legacy route: `/policy` now redirects to `/governance`
- Main implementation: `packages/dashboard/src/pages/Governance.tsx`
- Route wiring: `packages/dashboard/src/App.tsx`

## What The Page Is Trying To Be

The page is currently a combined surface for five different concerns:

1. Platform IAM visibility
2. Secret rotation and audit logging
3. Admin tool-grant management
4. Tool reliability / tool expiration monitoring
5. Policy lifecycle monitoring and manual policy actions

The page header describes this as:

> Governance controls, policy lifecycle, and live observability

That is directionally true, but in practice the page is still an operational inventory page more than a decision-making governance console.

## Current Top-Level Tabs

The page currently has five tabs:

1. Overview
2. Platform IAM
3. Admin & Access
4. Tool Health
5. Policy

## Tab-by-Tab Review

### 1. Overview

Purpose today:

- Show a compressed summary of alerts and policy state

What it displays:

- KPI cards for:
	- Open Alerts
	- IAM Identities
	- Active Policies
	- Canaries
	- Candidates
- A "Governance Alerts" list composed from:
	- IAM drift items
	- expiring secrets
	- rolled-back policies
	- today's failed platform audit entries
- A "Policy Lifecycle Snapshot" showing counts for:
	- draft
	- candidate
	- canary
	- active
- A "Canary Watch" list for current canary policies

What data feeds it:

- `/api/platform-iam-state`
- `/api/platform-audit-log?limit=50`
- `/api/platform-secret-rotation`
- `/api/policy_versions?limit=200`

What it is useful for:

- Quick triage of whether anything looks off
- Seeing that policy pipeline activity exists

What it does not tell you well:

- Whether any of these alerts matter strategically
- Which issues are blocking the company versus just noisy
- Whether policy canaries are improving outcomes or just moving through states
- Why a failure happened in operational terms
- Who owns each issue and what action is expected

Bottom line:

- This tab is a summary board, not an executive governance view.

### 2. Platform IAM

Purpose today:

- Inventory platform identities, IAM drift, secret expiry, and recent platform access activity

What it displays:

- Summary cards for:
	- Total Identities
	- Out-of-Sync
	- Expiring Secrets
	- Platforms
- Drift alert cards for:
	- IAM entries where `in_sync = false`
	- secrets expiring within 90 days
- Platform-specific collapsible tables for:
	- GCP
	- M365
	- GitHub
	- Stripe
	- Vercel
- Audit log table with filters by:
	- platform
	- agent
- Secret rotation table
- "Run Audit Now" button that posts to the scheduler governance sync endpoint

What data feeds it:

- `/api/platform-iam-state`
- `/api/platform-audit-log?limit=50`
- `/api/platform-secret-rotation`
- `POST ${SCHEDULER_URL}/sync/governance`

What it is useful for:

- Verifying that credentials and identities exist
- Spotting obvious IAM drift or upcoming secret expiry
- Inspecting raw-ish operational access history

What it does not tell you well:

- Whether the current permissions are correct from a policy standpoint
- Which identities are genuinely over-privileged versus merely different from desired state
- Whether audit entries represent expected work or risky behavior
- Whether a given platform is healthy overall
- Whether there is a material compliance problem

Bottom line:

- This tab is mostly an inventory and operations table view. It is useful for debugging, not very useful for governance judgment.

### 3. Admin & Access

Purpose today:

- Manage agent tool grants and pending access decisions

What it displays:

- Summary cards for:
	- Agents with Tools
	- Active Grants
	- Built-in Tools
	- Pending Approvals
- Expiring grant warning block
- Pending approvals queue for admins
- Search and filters for:
	- access surface
	- agent
	- grantor
	- free-text search
- Access summary for a selected access surface
- Grant Tool Access form for admin users
- Department-grouped access matrix by agent
- Revocation history table

What data feeds it:

- `/api/agent-tool-grants?order=agent_role.asc,tool_name.asc`
- `/api/decisions?status=pending&order=created_at.desc&limit=20`
- `POST /api/agent-tool-grants`
- `PATCH /api/agent-tool-grants/:id`
- `PATCH /api/decisions/:id`

Current special behavior:

- Admin controls are gated to the allowlist in `ADMIN_EMAILS`
- The grant form hardcodes `granted_by: 'kristina'`
- Approval resolution also hardcodes `resolved_by: 'kristina'`

What it is useful for:

- Seeing who has what tools
- Manually granting or revoking access
- Reviewing pending access-related decisions

What it does not tell you well:

- Whether grants are aligned to role intent or least privilege
- Which grants are risky, redundant, or stale
- Which tools are actually necessary by business process
- Whether an approval changed company risk materially

Bottom line:

- This is the most actionable tab today, but it is still an admin console, not a governance decision surface.

### 4. Tool Health

Purpose today:

- Show tool reliability and recent tool expiration events

What it displays:

- Summary cards for:
	- Static Tools
	- Runtime Tools
	- Dynamic Registry
	- Recently Expired
- "Recently Expired Tools" list with re-enable buttons
- "Lowest Reliability Tools (Bottom 5)" table with:
	- reliability score
	- success rate
	- calls
	- timeouts
	- downstream defect count

What data feeds it:

- `/api/tool-reputation?order=reliability_score.asc.nullslast&limit=100`
- `POST ${SCHEDULER_URL}/tools/re-enable`

What it is useful for:

- Spotting obviously degraded tools
- Recovering recently expired tools
- Seeing tool source mix across static/runtime/dynamic registry

What it does not tell you well:

- Which broken tools are hurting important workflows versus edge cases
- Which agents or departments depend on the failing tools most
- Whether the reliability issue is improving or degrading over time
- Whether a tool should be fixed, retired, or replaced

Bottom line:

- This is observability for tooling, but not yet decision-grade observability.

### 5. Policy

Purpose today:

- Monitor the policy lifecycle and provide manual triggers for collection and evaluation

This tab has its own sub-tabs:

1. Active
2. Canary
3. Pipeline
4. History
5. Controls

#### Active

Shows:

- active policies only
- columns for type, agent, version, promoted time, eval score

#### Canary

Shows:

- canary policies only
- per-policy cards with type, agent, version, time in canary, eval score
- a visual progress bar based on eval score

#### Pipeline

Shows:

- four columns for draft, candidate, canary, active
- count by stage
- up to five example entries per stage

#### History

Shows:

- filterable full history table by policy type and status
- columns for type, agent, version, status, eval, source, created, rollback reason
- pagination

#### Controls

Shows:

- button to collect proposals now
- button to run evaluation now
- success/error status messages after button presses

What data feeds it:

- `/api/policy_versions?limit=200`
- `POST ${SCHEDULER_URL}/policy/collect`
- `POST ${SCHEDULER_URL}/policy/evaluate`

Related backend automation that exists but is not surfaced very deeply in the UI:

- `POST /policy/collect`
	- collects draft proposals
	- scheduler comment says twice daily: `0 3,15 * * *`
- `POST /policy/evaluate`
	- evaluates draft policies offline
	- scheduler comment says daily: `0 5 * * *`
- `POST /policy/canary-check`
	- manages canary lifecycle
	- scheduler comment says every 4 hours: `0 */4 * * *`

Where policy proposals come from in the backend:

- policy proposal collector
- replay evaluator
- canary manager
- memory consolidator promoting proven procedures into `policy_versions`

What it is useful for:

- Confirming that the learning governor pipeline exists and is moving
- Inspecting raw policy lifecycle status
- Manually kicking collection and evaluation jobs

What it does not tell you well:

- What a policy actually changes operationally
- Whether a policy meaningfully improved outcomes
- Which policies are important versus cosmetic
- Why an executive should care about one policy over another
- What the current active policy set means in plain English

Bottom line:

- This tab exposes the machinery of policy governance more than the meaning of policy governance.

## Current Data Model Behind The Page

The page is built from a mix of database-backed dashboard APIs and scheduler action endpoints.

Primary dashboard reads:

- `platform_iam_state`
- `platform_audit_log`
- `platform_secret_rotation`
- `policy_versions`
- `agent_tool_grants`
- `decisions`
- `tool_reputation`

Primary scheduler actions:

- `/sync/governance`
- `/policy/collect`
- `/policy/evaluate`
- `/policy/canary-check`
- `/tools/re-enable`

## What The Page Currently Answers Well

The page is reasonably good at answering questions like:

- What identities do we have?
- Which secrets are expiring?
- Which agent has which tool?
- Which tools are unreliable?
- Are there draft/candidate/canary/active policies in the system?
- Can I manually trigger policy collection or evaluation?

## What The Page Does Not Currently Answer Well

The page is weak at answering the questions that matter most for real governance:

- What are the top governance risks right now?
- What decisions do I need to make today?
- What changed since yesterday or last week?
- Which problems are critical versus informational?
- What business process or team is affected by each problem?
- Which active policies are actually shaping behavior?
- Did a policy improve quality, speed, cost, safety, or autonomy?
- What should be escalated, approved, rolled back, or ignored?

## Plain-English Assessment

Today the page is a merged surface of:

- infra inventory
- admin controls
- tool telemetry
- policy pipeline state

That means it contains real information, but most of it is implementation-detail information.

The page is stronger as an operator/developer console than as a leadership governance surface.

If you are reacting with "this doesn’t really tell me anything," that reaction is accurate. The current page mostly tells you:

- what objects exist
- what state they are in
- what buttons can be pressed

It does not yet translate those objects and states into:

- decisions
- risk levels
- ownership
- outcomes
- narratives

## Likely Overhaul Areas

Without proposing a redesign yet, these are the parts most likely to need overhaul because they are the least decision-useful:

1. Overview needs to become an actual executive summary rather than a KPI collage.
2. Platform IAM needs to distinguish material risk from raw drift.
3. Admin & Access needs least-privilege and stale-access analysis, not just grant inventory.
4. Tool Health needs business impact and trend context.
5. Policy needs human-readable "what changed" and "why it matters" summaries.

## Files To Review Next

If you want to inspect the implementation directly, these are the main files:

- `packages/dashboard/src/pages/Governance.tsx`
- `packages/dashboard/src/App.tsx`
- `packages/scheduler/src/server.ts`
- `packages/scheduler/src/policyProposalCollector.ts`
- `packages/scheduler/src/policyReplayEvaluator.ts`
- `packages/scheduler/src/policyCanaryManager.ts`
- `packages/scheduler/src/dashboardApi.ts`

## Recommendation For Next Review Step

Use this document as the baseline inventory, then decide the overhaul in one of these directions:

1. Keep this as an operator console and create a separate executive governance page.
2. Transform this page into an executive decision surface and move raw tables into drill-down subpages.
3. Split governance into three clearer surfaces: access, policy, and observability.

If you want, the next step can be a second doc that turns this inventory into a concrete overhaul proposal with recommended information architecture.
