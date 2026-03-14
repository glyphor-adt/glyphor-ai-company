# Executive, Operations & Specialist Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Runner Type | Skills |
|-------|------|------------|-------------|--------|
| Sarah Chen | Chief of Staff | Founders | OrchestratorRunner | `cross-team-coordination` (v2), `decision-routing` (v2) |
| Atlas Vega | Ops & System Intelligence | Sarah Chen | OrchestratorRunner | `system-monitoring` (v2), `incident-response` (v2, in engineering/), `platform-monitoring` (v2, in engineering/) |
| Adi Rose | Executive Assistant to COO | Sarah Chen | Dynamic runner | `executive-support` (NEW), `cross-team-coordination` (v2, shared) |
| Jasmine Rivera | Head of People & Culture | Sarah Chen | Dynamic runner | `talent-management` (NEW) |

> **Note:** Sarah and Atlas are both OrchestratorRunners on the highest heartbeat tier (every 10 min). Sarah's heartbeat includes directive detection — she's woken immediately when founders create new directives.

> **Note:** Atlas also holds `incident-response` and `platform-monitoring` from the Engineering skill set. Those skills are infrastructure-focused; `system-monitoring` is agent-org-focused. Together they cover the full ops surface.

> **Note:** Adi Rose and Jasmine Rivera are specialist/dynamic agents (no file-based runners) — they use `runDynamicAgent.ts`.

## Architecture References

**Sarah's operating cadence:**
| Schedule | Time (CT) | Purpose |
|----------|-----------|---------|
| `cos-briefing-kristina` | 7:00 AM | Morning briefing for Kristina |
| `cos-briefing-andrew` | 7:30 AM | Morning briefing for Andrew |
| `cos-eod-summary` | 6:00 PM | End-of-day summary |
| `cos-orchestrate` | Every hour | Directive sweep (backup for heartbeat) |
| Heartbeat (high tier) | Every 10 min | Directive detection + work loop |

**Atlas's operating cadence:**
| Schedule | Time/Freq | Purpose |
|----------|-----------|---------|
| `ops-health-check` | Every 10 min | System health |
| `ops-freshness-check` | Every 30 min | Data freshness |
| `ops-cost-check` | Every hour | Cost awareness |
| `ops-morning-status` | 6:00 AM | Morning status report |
| `ops-evening-status` | 5:00 PM | Evening status report |

**Work assignment pipeline:**
```
Founder creates directive → heartbeat detects within ~10 min
  → Sarah wakes with 'orchestrate' task
  → Sarah decomposes into work_assignments with dependencies
  → Heartbeat dispatches in dependency-ordered waves
  → Agents execute (TaskRunner, task tier, ~150-line prompt)
  → assignment.submitted → wakes Sarah immediately
  → Sarah evaluates, revises or accepts
  → Sarah synthesizes final deliverable
```

**Priority stack (executeWorkLoop):**
P1: URGENT (needs_revision, urgent messages)
P2: ACTIVE WORK (pending/dispatched/in_progress assignments)
P3: MESSAGES (unread DMs)
P4: SCHEDULED (cron — handled by Cloud Scheduler)
P5: PROACTIVE (self-directed, cooldown: CoS/Ops 1hr, CTO/CFO 2hr, VPs 4hr, sub-team 6hr)
P6: NOTHING (fast exit, no dispatch)

**Three-tier authority model:**
- Green: Agent autonomous (reversible, low-cost, within domain)
- Yellow: One founder (spending $50-5K, external content, agent creation, tactical changes)
- Red: Both founders (spending >$5K, strategy, legal commitments, authority model changes)
- Decision cards → #decisions Teams channel → Adaptive Cards with approve/reject
- 4-hour reminder, 24-hour escalation to morning briefing

**Wake rules (event-driven activation):**
- `alert.triggered (critical)` → CTO + Ops + CoS (immediate)
- `assignment.submitted` → CoS (immediate, 5min cooldown)
- `assignment.blocked` → CoS (immediate, 2min cooldown)
- `decision.resolved` → filing agent (immediate, 5min cooldown)
- `health_check_failure` → CTO + Ops (immediate)
- Full wake rules table in architecture doc section "Reactive Wake System"

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| cross-team-coordination | 6 lines, 3 tools | ~185 lines, 22 tools |
| decision-routing | 6 lines, 3 tools | ~160 lines, 11 tools |
| system-monitoring | 6 lines, 3 tools | ~170 lines, 26 tools |
| executive-support | (didn't exist) | ~120 lines, 14 tools |
| talent-management | (didn't exist) | ~155 lines, 13 tools |

## Key Design Decisions

**1. Sarah's coordination skill maps the actual directive pipeline.** The skill includes the exact flow: directive → heartbeat detection → wake → decomposition → wave-dispatched assignments → submission → evaluation → synthesis. It shows concrete dependency chain examples (Wave 0: parallel research → Wave 1: QC → Wave 2: departmental analysis → Wave 3: synthesis). Not a checklist — the actual operating model.

**2. Decision-routing codifies the three-tier system completely.** The skill defines exactly what belongs in each tier with specific dollar thresholds ($50 = Yellow floor, $5K = Red floor), specific categories for each tier, and the routing logic (technical → Kristina, business → Andrew, spans both → either or escalate). It includes pattern analysis — monthly review of decision volume and approval rates to propose tier adjustments. Authority model changes are themselves Red decisions (both founders).

**3. System-monitoring covers the agent layer, not just infrastructure.** Atlas's `platform-monitoring` and `incident-response` skills (from Engineering) cover Cloud Run, Cloud SQL, and Cloud Tasks. This skill covers the 28-agent organization: run success rates, error patterns, performance drift, stuck agents, data pipeline freshness, event bus health, tool health, and cost awareness. The distinction is: infrastructure vs. the intelligent layer that runs on top of it.

**4. Atlas's triage priority is explicit.** When multiple things go wrong simultaneously, the skill defines the triage order: data loss/security → revenue-affecting outage → agent failure cascade → individual agent failure → performance degradation → cost anomaly. This prevents the most common ops mistake: working on the interesting problem instead of the important one.

**5. Adi Rose is a focused assistant, not a second Sarah.** The skill draws a clear boundary: Sarah serves the company, Adi serves Andrew. When Andrew gives Adi a request that's really a directive (affecting multiple agents), Adi routes it to Sarah for proper decomposition. Adi never tries to coordinate agents directly.

**6. Talent management adapts HR to an AI workforce.** Performance is quantified (run success rate, quality scores, trust scores, efficiency). Development is prompt engineering and skill refinement. Hiring is agent creation. Firing is agent retirement. Engagement surveys measure utilization rate and assignment completion, not "satisfaction." The skill reframes every HR concept for a workforce where performance is fully measurable and development is configuration, not training.

**7. Remove `financial-reporting` from Sarah.** As noted in the Finance skill set index, Sarah should no longer hold `financial-reporting`. She reads Nadia's output in her synthesis role — she doesn't produce financial reports herself.

## File Inventory

```
skills/executive/
├── cross-team-coordination.md  # v2 — Sarah Chen, Adi Rose (shared)
├── decision-routing.md         # v2 — Sarah Chen
├── system-monitoring.md        # v2 — Atlas Vega
├── executive-support.md        # NEW — Adi Rose
├── talent-management.md        # NEW — Jasmine Rivera
└── INDEX.md                    # This file
```

## Cross-Team Notes

- Atlas also holds `incident-response` and `platform-monitoring` from `skills/engineering/`. Three skills total for Ops.
- Adi Rose holds `cross-team-coordination` (shared with Sarah) because her executive support role involves understanding the coordination system to properly route Andrew's requests.
- Jasmine Rivera needs department reassignment from `(unassigned)` to `People & Culture`.
- Adi Rose needs department reassignment from `(unassigned)` to `Executive Office`.

## Grand Total

```
skills/
├── engineering/    (7 skills — code-review, incident-response, platform-monitoring,
│                    quality-assurance, infrastructure-ops, frontend-development,
│                    tech-spec-writing)
├── design/         (5 skills — design-review, design-system-management,
│                    brand-management, ui-development, ux-design)
├── marketing/      (5 skills — content-creation, seo-optimization,
│                    social-media-management, competitive-intelligence,
│                    content-analytics)
├── research/       (2 skills — research-management, market-research)
├── finance/        (4 skills — financial-reporting, budget-monitoring,
│                    revenue-analysis, tax-strategy)
├── legal/          (3 skills — legal-review, compliance-monitoring, ip-management)
├── operations/     (2 skills — access-management, tenant-administration)
└── executive/      (5 skills — cross-team-coordination, decision-routing,
                     system-monitoring, executive-support, talent-management)

Total: 33 skill playbooks covering all 28 agents
```
