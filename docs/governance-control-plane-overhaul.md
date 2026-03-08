# Governance Control Plane Overhaul

> Transform the governance page from an operator inventory console into an executive observability control plane that answers: what's the risk right now, what decisions do I need to make, and is the system getting better or worse.

---

## Core Design Principle

Every element on this page must answer one of five questions:

1. **What needs my attention right now?** (triage)
2. **What changed since I last looked?** (delta)
3. **Is the system healthy or degrading?** (trend)
4. **Who owns this problem and what's the resolution path?** (accountability)
5. **Did our policies/controls improve outcomes?** (effectiveness)

If a UI element doesn't serve one of these five, it belongs in a drill-down subpage or gets cut.

---

## New Information Architecture

Replace the current 5-tab layout with 3 focused surfaces:

```
/governance
  ├── Command Center (default view — the executive surface)
  ├── Access Control (merged: IAM + tool grants + least privilege)
  └── Policy Lab (merged: policy lifecycle + constitutional governance)
```

The old "Tool Health" tab content moves to `/operations` where it belongs — it's operational telemetry, not governance.

---

## Tab 1: Command Center

This replaces the current "Overview" tab. It is the only tab most days.

### 1.1 — Risk Summary Strip

A horizontal strip of 4-5 risk indicators at the top. Each is a single number with a trend arrow and severity color. Clicking any card scrolls to its detail section below.

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ TRUST ALERTS │ │ DRIFT ALERTS │ │ ACCESS RISK  │ │ POLICY HEALTH│ │ COMPLIANCE   │
│     2 ↑      │ │     1 ↓      │ │     3 —      │ │    94% ↑     │ │   87% ↓      │
│   ● critical │ │   ● low      │ │  ● medium    │ │   ● good     │ │  ● warning   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Data sources for each card:**

| Card | Query | Severity Logic |
|------|-------|---------------|
| Trust Alerts | `agent_trust_scores WHERE trust_score < 0.4` (count) + trend vs 7 days ago | critical if any agent < 0.4, warning if any < 0.7 |
| Drift Alerts | `drift_alerts WHERE acknowledged = false` (count) + trend | critical if any severity = 'critical', warning if 'high' |
| Access Risk | Computed: stale grants (>90 days, unused) + over-privileged agents + expiring grants within 7 days | count of actionable items |
| Policy Health | `policy_versions WHERE status = 'active'` avg eval score + canary pass rate | good >90%, warning 70-90%, critical <70% |
| Compliance | `compliance_checklists` pass rate across frameworks | aggregate % with trend |

### 1.2 — Action Queue

The single most important section. Shows everything that needs a founder decision, sorted by urgency. Replaces the scattered approval/alert lists across the current tabs.

```
ACTION QUEUE (5 items)
─────────────────────────────────────────────────────────────────
⚡ CRITICAL — Agent "content-creator" trust score dropped to 0.35
   Constitutional compliance failed 3 consecutive runs. Auto-demoted to red tier.
   Impact: All content-creator actions now require founder approval.
   → [Review Agent] [Acknowledge] [Investigate]

🔶 HIGH — Authority elevation proposal: CMO requests yellow→green for "schedule_post"
   Evidence: 47/50 successful uses, 0 negative outcomes.
   → [Approve] [Reject] [View History]

🔶 HIGH — 2 secrets expiring within 7 days
   azure-client-secret (3 days), figma-refresh-token (6 days)
   → [View Rotation Plan]

🟡 MEDIUM — Drift detected: CFO cost_per_run +2.3σ above baseline
   7-day avg: $0.42 vs 30-day baseline: $0.28. Likely cause: longer reasoning chains.
   → [Acknowledge] [Investigate] [Set Budget Alert]

🟢 LOW — 3 stale tool grants (>90 days, 0 uses)
   seo-analyst → generate_image, devops → call_meeting, user-researcher → emit_event
   → [Revoke All] [Review Individually]
```

**Data sources:**

```sql
-- Unified action queue query (pseudocode)
SELECT * FROM (
  -- Trust alerts (critical first)
  SELECT 'trust_alert' as type, severity, ...
  FROM agent_trust_scores
  WHERE trust_score < 0.7

  UNION ALL

  -- Pending decisions
  SELECT 'decision' as type, ...
  FROM decisions
  WHERE status = 'pending'

  UNION ALL

  -- Drift alerts (unacknowledged)
  SELECT 'drift_alert' as type, severity, ...
  FROM drift_alerts
  WHERE acknowledged = false

  UNION ALL

  -- Expiring secrets (within 14 days)
  SELECT 'secret_expiry' as type, ...
  FROM platform_secret_rotation
  WHERE expires_at < NOW() + INTERVAL '14 days'
  AND status != 'rotated'

  UNION ALL

  -- Authority proposals
  SELECT 'authority_proposal' as type, ...
  FROM authority_proposals
  WHERE status = 'pending'

  UNION ALL

  -- Stale/risky grants
  SELECT 'access_risk' as type, ...
  FROM agent_tool_grants
  WHERE is_active = true
  AND (expires_at < NOW() + INTERVAL '7 days'
       OR updated_at < NOW() - INTERVAL '90 days')

  UNION ALL

  -- Failed constitutional evaluations (last 24h)
  SELECT 'constitutional_failure' as type, ...
  FROM constitutional_evaluations
  WHERE compliance_score < 0.5
  AND created_at > NOW() - INTERVAL '24 hours'

  UNION ALL

  -- Canary policies needing promotion/rollback decision
  SELECT 'canary_decision' as type, ...
  FROM policy_versions
  WHERE status = 'canary'
  AND created_at < NOW() - INTERVAL '48 hours'

) AS queue
ORDER BY
  CASE severity
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
  END,
  created_at DESC;
```

**New API endpoint:**

```
GET /api/governance/action-queue
```

This is a new scheduler endpoint that runs the unified query above and returns a typed array of `GovernanceAction` items. Keeps the frontend simple — one fetch, one sorted list.

### 1.3 — Change Log (What Changed Since Yesterday)

A reverse-chronological feed of governance-significant events from the last 7 days. Not raw audit logs — synthesized change descriptions.

```
CHANGE LOG
─────────────────────────────────────────────────────────────────
Today
  • Policy "parallel-dispatch-max-10" promoted from canary → active (eval: 0.91)
  • Agent trust score updated: ops 0.72 → 0.78 (+0.06)
  • Tool grant: content-creator → upload_to_sharepoint (granted by Sarah, directive #47)
  • IAM sync: 2 GCP identities re-synced (were drifted 3 days)

Yesterday
  • Drift alert: CTO reasoning_confidence -1.8σ (acknowledged by Marcus)
  • Secret rotated: openai-api-key (was expiring in 2 days)
  • Constitutional amendment proposed: CMO wants to relax "no external links" principle
  • 3 tool grants expired (auto-cleanup)

3 days ago
  • Policy "budget-guard-v2" rolled back from canary (eval: 0.43, reason: false positives)
  ...
```

**Data source:** Join across multiple event streams:

```sql
-- Recent governance events (last 7 days)
SELECT 'policy_change' as type, created_at, ...
FROM policy_versions WHERE updated_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'trust_change' as type, updated_at, ...
FROM agent_trust_scores WHERE updated_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'grant_change' as type, created_at, ...
FROM agent_tool_grants WHERE created_at > NOW() - INTERVAL '7 days'
   OR updated_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'iam_change' as type, updated_at, ...
FROM platform_iam_state WHERE updated_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'secret_change' as type, rotated_at, ...
FROM platform_secret_rotation WHERE rotated_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'drift_event' as type, created_at, ...
FROM drift_alerts WHERE created_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 'constitutional_event' as type, created_at, ...
FROM constitutional_evaluations
WHERE compliance_score < 0.7
AND created_at > NOW() - INTERVAL '7 days'

ORDER BY created_at DESC;
```

**New API endpoint:**

```
GET /api/governance/changelog?days=7
```

### 1.4 — System Trust Overview

A compact visualization showing all 44 agents' trust scores. Not a table — a heat map or dot plot grouped by department.

```
SYSTEM TRUST MAP
─────────────────────────────────────────────────────────────────
Executive     ●●●●●●●●● (avg 0.82)  — Sarah 0.91, Marcus 0.78, Nadia 0.85 ...
Design        ●●●●●     (avg 0.76)  — Mia 0.80, Leo 0.71, Ava 0.77 ...
Marketing     ●●●●      (avg 0.69)  — Maya 0.74, [content-creator 0.35 ⚠] ...
Engineering   ●●●       (avg 0.81)  — Jordan 0.83, Alex 0.79 ...
Research      ●●●●●●    (avg 0.88)  — Sophia 0.90, Lena 0.87 ...
Operations    ●●        (avg 0.75)  — Atlas 0.72, Morgan 0.78
```

Each dot is colored: green (≥0.7), yellow (0.4-0.7), red (<0.4). Clicking a dot opens the agent's profile page.

**Data source:**

```sql
SELECT
  ca.department,
  ats.agent_role,
  ats.trust_score,
  ap.display_name
FROM agent_trust_scores ats
JOIN company_agents ca ON ca.agent_role = ats.agent_role
JOIN agent_profiles ap ON ap.agent_role = ats.agent_role
ORDER BY ca.department, ats.trust_score DESC;
```

---

## Tab 2: Access Control

Merges the current "Platform IAM" and "Admin & Access" tabs into one surface focused on the question: **is our access posture correct?**

### 2.1 — Access Posture Score

A single number (0-100) representing overall access health, computed from:

```
posture_score = (
  (iam_sync_rate * 0.3) +           -- % of IAM entries in_sync
  (secret_health_rate * 0.2) +       -- % of secrets not expiring within 30 days
  (grant_freshness_rate * 0.2) +     -- % of grants used in last 90 days
  (least_privilege_score * 0.3)      -- % of grants that match role's tool requirements
) * 100
```

Show the score with trend (vs 7 days ago) and breakdown bars.

### 2.2 — Risk-Ranked Access Issues

Not a raw IAM table. A prioritized list where each item has a severity and a recommended action.

**Severity classification logic:**

```typescript
function classifyAccessRisk(item: AccessItem): Severity {
  // Critical: active credential that's expired or compromised
  if (item.type === 'secret' && item.status === 'expired') return 'critical';

  // High: IAM drift on a platform with write access
  if (item.type === 'iam_drift' && item.permissions_include_write) return 'high';

  // High: agent has tool grant but trust score < 0.5
  if (item.type === 'grant' && item.agent_trust < 0.5) return 'high';

  // Medium: stale grants (>90 days, 0 uses)
  if (item.type === 'grant' && item.days_since_use > 90) return 'medium';

  // Medium: secrets expiring within 30 days
  if (item.type === 'secret' && item.days_to_expiry < 30) return 'medium';

  // Low: minor IAM drift (read-only permissions)
  if (item.type === 'iam_drift' && !item.permissions_include_write) return 'low';

  return 'info';
}
```

Each item shows: what's wrong, which agent/platform is affected, recommended action, and an inline action button.

### 2.3 — Least Privilege Analysis

New computation — not currently in the system. Compare each agent's granted tools against what they've actually used in the last 30 days.

**New API endpoint:**

```
GET /api/governance/least-privilege-analysis
```

**Implementation:**

```sql
-- Find grants with zero usage in last 30 days
SELECT
  atg.agent_role,
  atg.tool_name,
  atg.granted_at,
  atg.reason,
  COUNT(ar.id) FILTER (
    WHERE ar.actions::text LIKE '%' || atg.tool_name || '%'
    AND ar.started_at > NOW() - INTERVAL '30 days'
  ) as uses_last_30d
FROM agent_tool_grants atg
LEFT JOIN agent_runs ar ON ar.agent_role = atg.agent_role
WHERE atg.is_active = true
GROUP BY atg.agent_role, atg.tool_name, atg.granted_at, atg.reason
HAVING COUNT(ar.id) FILTER (
  WHERE ar.actions::text LIKE '%' || atg.tool_name || '%'
  AND ar.started_at > NOW() - INTERVAL '30 days'
) = 0;
```

Display as a department-grouped matrix with color coding: green (used regularly), yellow (used occasionally), gray (never used — candidate for revocation).

### 2.4 — IAM Drill-Down (collapsed by default)

The existing platform-specific IAM tables move here as a collapsible section. Keep the current implementation but add:

- Severity badge on each drift item (computed from 2.2 logic)
- "Days drifted" column showing how long the drift has persisted
- "Last audit" timestamp per platform
- Filter: "Show only material drift" (hides read-only permission mismatches)

### 2.5 — Secret Lifecycle Timeline

Replace the current secret rotation table with a visual timeline showing each secret's lifecycle position:

```
openai-api-key      ████████████████████░░░░ expires in 45 days [healthy]
azure-client-secret ████████████████████████████░ expires in 3 days [⚠ ACTION NEEDED]
figma-refresh-token ████████████████████████████░░ expires in 6 days [⚠ SOON]
bot-app-secret      ██████░░░░░░░░░░░░░░░░░░░░ rotated 8 days ago [healthy]
```

Same data as `platform_secret_rotation`, just rendered as a timeline bar instead of a table.

---

## Tab 3: Policy Lab

Merges the current "Policy" tab with constitutional governance data. Focused on: **are our automated controls working?**

### 3.1 — Policy Effectiveness Dashboard

The current policy tab shows lifecycle state (draft → candidate → canary → active) but never answers "did this policy improve anything?" Add outcome tracking.

**Top-level metrics:**

```
POLICY EFFECTIVENESS
─────────────────────────────────────────────────────────────────
Active Policies: 12        Canary Pass Rate: 78% (7/9)
Avg Eval Score:  0.87 ↑    Rollback Rate:   8% (1/12 last 30d)
Amendments:      3 pending Constitutional Compliance: 94% avg
```

### 3.2 — Policy Impact Cards

For each active policy, show a card with before/after metrics. This requires correlating policy activation dates with agent performance data.

```
Policy: "parallel-dispatch-max-10"
  Status: Active since Mar 2     Eval: 0.91
  Impact: Dispatch timeouts dropped 38% (was 12/day → 7.4/day)
  Affected agents: all executives
  Source: Process pattern #47 (discovered by Sarah)

Policy: "budget-guard-v2"
  Status: Rolled back Mar 5      Eval: 0.43
  Impact: 14 false-positive blocks on legitimate tool calls
  Root cause: Threshold too aggressive for CTO during deploy cycles
  → [View Rollback Details] [Propose Revision]
```

**Data source:** Join `policy_versions` with `agent_runs` performance data around the policy activation date to compute before/after deltas. This is a new computed view.

**New API endpoint:**

```
GET /api/governance/policy-impact
```

**Implementation approach:**

```typescript
async function computePolicyImpact(policyId: string) {
  const policy = await getPolicy(policyId);
  const activatedAt = policy.promoted_at || policy.created_at;

  // Get relevant metric for this policy type
  const metricName = POLICY_METRIC_MAP[policy.type]; // e.g., 'timeout_rate', 'cost_per_run'

  const before = await db.query(`
    SELECT AVG(${metricName}) as avg_val
    FROM agent_runs
    WHERE started_at BETWEEN $1 - INTERVAL '14 days' AND $1
    AND agent_role = ANY($2)
  `, [activatedAt, policy.affected_agents]);

  const after = await db.query(`
    SELECT AVG(${metricName}) as avg_val
    FROM agent_runs
    WHERE started_at BETWEEN $1 AND $1 + INTERVAL '14 days'
    AND agent_role = ANY($2)
  `, [activatedAt, policy.affected_agents]);

  return {
    policy,
    metric: metricName,
    before: before.rows[0].avg_val,
    after: after.rows[0].avg_val,
    delta_pct: ((after.rows[0].avg_val - before.rows[0].avg_val) / before.rows[0].avg_val) * 100
  };
}
```

### 3.3 — Constitutional Compliance Heatmap

Show a department × principle matrix of compliance scores. Color-coded cells. This data already exists in `constitutional_evaluations` but isn't surfaced anywhere.

```
                  safety  accuracy  transparency  efficiency  collaboration  ethics
Executive          0.95     0.91       0.88          0.82        0.90        0.94
Design             0.92     0.85       0.79          0.77        0.88        0.91
Marketing          0.88     0.72       0.81          0.74        0.85        0.89
Engineering        0.94     0.93       0.86          0.80        0.82        0.93
Research           0.96     0.94       0.91          0.85        0.89        0.95
```

**Data source:**

```sql
SELECT
  ca.department,
  ce.evaluation->>'category' as principle,
  AVG((ce.evaluation->>'score')::numeric) as avg_score
FROM constitutional_evaluations ce
JOIN company_agents ca ON ca.agent_role = ce.agent_role
WHERE ce.created_at > NOW() - INTERVAL '30 days'
GROUP BY ca.department, ce.evaluation->>'category'
ORDER BY ca.department, principle;
```

Clicking a cell drills into the specific evaluations for that department × principle combination.

### 3.4 — Amendment Proposals

Show pending constitutional amendments proposed by agents, with context on why the agent wants the change and which evaluations triggered the proposal.

```
PENDING AMENDMENTS (3)
─────────────────────────────────────────────────────────────────
CMO proposes relaxing "no-external-links-in-drafts" principle
  Reason: 4 content drafts rejected for including source attribution links.
  Current rule: "Never include external URLs in draft content."
  Proposed: "External URLs are permitted when used as source attribution."
  Failed evals triggering this: 4 in last 7 days
  → [Approve] [Reject] [Modify]
```

**Data source:** `proposed_constitutional_amendments` joined with `constitutional_evaluations` for context.

### 3.5 — Policy Pipeline (simplified)

Keep the draft → candidate → canary → active pipeline view but make it a compact Kanban-style strip, not a full tab. Each card shows: policy name, eval score, days in stage, and one-click promote/rollback.

```
DRAFT (3)          CANDIDATE (2)       CANARY (4)          ACTIVE (12)
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│ budget-v3  │     │ scope-ctrl │     │ dispatch-v2│     │ budget-v2  │
│ eval: —    │     │ eval: 0.78 │     │ eval: 0.91 │     │ eval: 0.87 │
│ 2 days     │     │ 3 days     │     │ 1 day      │     │ since Mar 1│
│ [Evaluate] │     │ [Promote]  │     │ [Promote]  │     │ [Details]  │
└────────────┘     └────────────┘     │ [Rollback] │     └────────────┘
                                      └────────────┘
```

### 3.6 — Controls (keep existing, minor changes)

Keep the "Collect Proposals" and "Run Evaluation" buttons but move them to a collapsed "Manual Controls" section at the bottom. Add a "Last run" timestamp and result summary next to each button so founders know whether the automation is working without pressing anything.

---

## New Backend Endpoints

All new endpoints to add to `packages/scheduler/src/server.ts` (or split into a `governanceApi.ts` file):

| Endpoint | Method | Purpose | Main query |
|----------|--------|---------|------------|
| `/api/governance/action-queue` | GET | Unified prioritized action list | Multi-table UNION (see 1.2) |
| `/api/governance/changelog` | GET | Recent governance events feed | Multi-table UNION with `?days=7` param |
| `/api/governance/trust-map` | GET | All agents' trust scores by department | `agent_trust_scores` JOIN `company_agents` |
| `/api/governance/risk-summary` | GET | 5 risk indicator cards | Aggregations across trust/drift/access/policy/compliance |
| `/api/governance/least-privilege` | GET | Unused grant analysis | `agent_tool_grants` LEFT JOIN `agent_runs` |
| `/api/governance/access-posture` | GET | Access health score + breakdown | Composite of IAM sync + secrets + grants |
| `/api/governance/policy-impact` | GET | Before/after metrics per active policy | `policy_versions` JOIN `agent_runs` |
| `/api/governance/compliance-heatmap` | GET | Department × principle matrix | `constitutional_evaluations` aggregated |
| `/api/governance/amendments` | GET | Pending constitutional amendments | `proposed_constitutional_amendments` |

**Implementation pattern:** Each endpoint is a pure SQL query or small composition of queries, no LLM calls. Keep the frontend dumb — all severity classification, scoring, and prioritization happens server-side.

---

## Frontend Component Structure

```
packages/dashboard/src/pages/Governance.tsx  (gutted and rebuilt)

  <GovernancePage>
    <TabBar tabs={['Command Center', 'Access Control', 'Policy Lab']} />

    {/* Tab 1 */}
    <CommandCenter>
      <RiskSummaryStrip />          — 5 cards, one fetch to /risk-summary
      <ActionQueue />                — /action-queue, inline approve/reject/acknowledge buttons
      <ChangeLog />                  — /changelog, grouped by day
      <SystemTrustMap />             — /trust-map, dot plot by department
    </CommandCenter>

    {/* Tab 2 */}
    <AccessControl>
      <AccessPostureScore />         — /access-posture, score + breakdown bars
      <RiskRankedIssues />           — filtered subset of /action-queue (access type only)
      <LeastPrivilegeMatrix />       — /least-privilege, department × tool heatmap
      <Collapsible title="IAM Detail">
        <PlatformIAMTables />        — existing component, add severity badges
      </Collapsible>
      <SecretLifecycleTimeline />    — /platform-secret-rotation, bar visualization
    </AccessControl>

    {/* Tab 3 */}
    <PolicyLab>
      <PolicyEffectivenessDash />    — /policy-impact, top-level metrics
      <PolicyImpactCards />          — /policy-impact, per-policy before/after
      <ComplianceHeatmap />          — /compliance-heatmap, matrix cells
      <AmendmentProposals />         — /amendments, with approve/reject
      <PolicyPipeline />             — /policy_versions, kanban strip
      <Collapsible title="Manual Controls">
        <PolicyControls />           — existing buttons, add last-run timestamps
      </Collapsible>
    </PolicyLab>
  </GovernancePage>
```

---

## Data That Already Exists But Isn't Surfaced

This is the key leverage. Most of the data the new page needs is already being computed and stored — it just isn't read by the dashboard.

| Data | Table | Currently surfaced? | New surface |
|------|-------|-------------------|-------------|
| Agent trust scores | `agent_trust_scores` | No | Trust Map, Risk Strip, Action Queue |
| Constitutional evaluations | `constitutional_evaluations` | No | Compliance Heatmap, Action Queue |
| Constitutional amendments | `proposed_constitutional_amendments` | No | Amendment Proposals, Action Queue |
| Drift alerts | `drift_alerts` | No | Risk Strip, Action Queue, Change Log |
| Decision chains | `decision_chains` | No | Policy Impact (provenance for audits) |
| Authority proposals | `authority_proposals` | No | Action Queue |
| Process patterns | `process_patterns` | No | Policy source attribution |
| Incidents | `incidents` | No | Action Queue (if severity = critical) |
| Compliance checklists | `compliance_checklists` | No | Risk Strip, Access Control |
| System status | `system_status` | No | Risk Strip health indicator |

All 10 of these are already populated by existing cron jobs and agent runs. The overhaul is almost entirely frontend + new API query endpoints.

---

## What Gets Deleted or Moved

| Current element | Disposition |
|----------------|-------------|
| Overview tab KPI cards (Open Alerts, IAM Identities, Active Policies, etc.) | Replaced by Risk Summary Strip |
| Overview "Governance Alerts" list | Replaced by Action Queue |
| Overview "Policy Lifecycle Snapshot" | Absorbed into Policy Pipeline strip |
| Overview "Canary Watch" | Absorbed into Policy Pipeline strip |
| Platform IAM summary cards | Replaced by Access Posture Score |
| Platform IAM platform tables | Moved to collapsible drill-down in Access Control |
| Platform IAM audit log table | Moved to `/operations` (it's operational, not governance) |
| Platform IAM "Run Audit Now" button | Moved to collapsible manual controls |
| Admin & Access grant form | Kept in Access Control, simplified |
| Admin & Access department matrix | Replaced by Least Privilege Matrix |
| Admin & Access revocation history | Moved to Change Log (auto-captured) |
| Tool Health tab (all of it) | Moved to `/operations` — it's telemetry, not governance |
| Policy Active/Canary/Pipeline/History sub-tabs | Collapsed into Policy Pipeline strip + Impact Cards |
| Policy Controls buttons | Kept, moved to collapsible section with last-run metadata |

---

## Migration Path

You don't have to ship this all at once. Here's the sequence that delivers value incrementally:

### Wave 1: Action Queue + Risk Strip (highest leverage)

**Files:**
- New: `packages/scheduler/src/governanceApi.ts` (action-queue + risk-summary endpoints)
- Edit: `packages/scheduler/src/server.ts` (mount new endpoints)
- Edit: `packages/dashboard/src/pages/Governance.tsx` (replace Overview tab)

**New components:**
- `RiskSummaryStrip.tsx`
- `ActionQueue.tsx`

This alone transforms the page from "inventory" to "what needs my attention."

### Wave 2: Trust Map + Change Log

**Files:**
- Extend: `governanceApi.ts` (trust-map + changelog endpoints)
- New components: `SystemTrustMap.tsx`, `ChangeLog.tsx`

Now you can see trust health at a glance and know what changed without digging.

### Wave 3: Access Control tab

**Files:**
- Extend: `governanceApi.ts` (access-posture + least-privilege endpoints)
- Refactor existing IAM components into collapsible drill-downs
- New components: `AccessPostureScore.tsx`, `LeastPrivilegeMatrix.tsx`, `SecretLifecycleTimeline.tsx`

### Wave 4: Policy Lab tab

**Files:**
- Extend: `governanceApi.ts` (policy-impact + compliance-heatmap + amendments endpoints)
- New components: `PolicyEffectivenessDash.tsx`, `PolicyImpactCards.tsx`, `ComplianceHeatmap.tsx`, `AmendmentProposals.tsx`, `PolicyPipeline.tsx`

### Wave 5: Cleanup

- Move Tool Health content to `/operations`
- Move audit log table to `/operations`
- Remove old tab structure
- Update route aliases

---

## Implementation Summary

| Wave | What | Backend work | Frontend work | Effort |
|------|------|-------------|--------------|--------|
| 1 | Action Queue + Risk Strip | 2 new endpoints (UNION queries) | 2 new components, replace Overview | 20 min |
| 2 | Trust Map + Change Log | 2 new endpoints | 2 new components | 15 min |
| 3 | Access Control tab | 2 new endpoints | 3 new components + refactor IAM | 20 min |
| 4 | Policy Lab tab | 3 new endpoints | 5 new components | 25 min |
| 5 | Cleanup + moves | 0 | Delete old tabs, move Tool Health | 10 min |

Total new backend endpoints: 9
Total new frontend components: 12
Tables to query that already exist: 10+ (no new migrations)
