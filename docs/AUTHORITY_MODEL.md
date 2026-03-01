# Authority Model

> Last updated: 2025-02-22

The authority model controls what actions AI agents can take autonomously versus what
requires human founder approval. Implemented in `packages/scheduler/src/authorityGates.ts`.

---

## Decision Tiers

| Tier | Approval | Notification | Escalation |
|------|----------|-------------|------------|
| **Green** | None — agent executes immediately | Logged in `activity_log` | N/A |
| **Yellow** | One designated founder | Adaptive Card to `#decisions` + reminders every 4 h | Auto-escalates to Red after 48 h |
| **Red** | Both founders must approve | Adaptive Card to `#decisions` + reminders every 4 h | Stays in queue until resolved |

Unknown / unmapped actions default to **Yellow** assigned to **both founders**.

---

## Green Actions (Autonomous)

Each agent has a specific set of green-tier actions. All agents include `on_demand` (dashboard chat).

### Sarah Chen — Chief of Staff

| Action | Description |
|--------|-------------|
| `compile_briefing` | Compile data for founder briefings |
| `route_decision` | Route a decision to the correct founder |
| `log_activity` | Write to activity log |
| `synthesize_report` | Cross-agent synthesis report |
| `check_escalations` | Check for overdue decisions |
| `generate_briefing` | Generate and send morning briefing |
| `morning_briefing` | Scheduled morning briefing task |
| `eod_summary` | End-of-day summary |
| `on_demand` | Dashboard chat |

### Marcus Reeves — CTO

| Action | Description |
|--------|-------------|
| `model_fallback` | Switch to fallback model on failure |
| `cache_optimization` | Optimize caching layer |
| `scale_within_budget` | Auto-scale within budget guard-rails |
| `staging_deploy` | Deploy to staging environment |
| `dependency_update` | Update dependencies (non-breaking) |
| `health_check` | General health check |
| `platform_health_check` | Full platform health sweep |
| `dependency_review` | Review dependency vulnerabilities |
| `on_demand` | Dashboard chat |

### Nadia Okafor — CFO

| Action | Description |
|--------|-------------|
| `cost_tracking` | Track and record costs |
| `standard_report` | Generate standard financial report |
| `margin_calculation` | Calculate product margins |
| `financial_modeling` | Run financial models |
| `daily_cost_check` | Scheduled daily cost analysis |
| `on_demand` | Dashboard chat |

### Elena Vasquez — CPO

| Action | Description |
|--------|-------------|
| `usage_analysis` | Analyze product usage patterns |
| `competitive_scan` | Scan competitive landscape |
| `feature_prioritization` | Prioritize features (RICE) |
| `user_research` | Synthesize user research |
| `roadmap_analysis` | Analyze roadmap alignment |
| `weekly_usage_analysis` | Scheduled usage analysis |
| `on_demand` | Dashboard chat |

### Maya Brooks — CMO

| Action | Description |
|--------|-------------|
| `blog_post` | Draft blog post |
| `social_post` | Draft social media post |
| `seo_analysis` | SEO analysis and recommendations |
| `case_study_draft` | Draft customer case study |
| `content_calendar` | Plan content calendar |
| `generate_content` | Generate content piece |
| `weekly_content_planning` | Scheduled content planning |
| `on_demand` | Dashboard chat |

### James Turner — VP Customer Success

| Action | Description |
|--------|-------------|
| `health_scoring` | Score customer health |
| `nurture_email` | Draft nurture email |
| `segment_update` | Update customer segments |
| `support_triage` | Triage support requests |
| `churn_detection` | Detect churn risk signals |
| `daily_health_scoring` | Scheduled health scoring |
| `on_demand` | Dashboard chat |

### Rachel Kim — VP Sales

| Action | Description |
|--------|-------------|
| `account_research` | Research enterprise accounts |
| `roi_calculator` | Build ROI calculator |
| `market_sizing` | Size addressable market |
| `kyc_research` | Know-Your-Customer research |
| `proposal_draft` | Draft enterprise proposal |
| `pipeline_review` | Scheduled pipeline review |
| `on_demand` | Dashboard chat |

---

## Yellow Actions (One Founder Required)

| Action | Assigned To | Rationale |
|--------|-------------|-----------|
| `model_switch_costly` | **Andrew** | Infrastructure cost impact |
| `roadmap_priority_change` | **Kristina** | Product strategy |
| `enterprise_outreach` | **Kristina** | Customer relationship |
| `content_strategy_shift` | **Kristina** | Brand direction |
| `infra_scaling_costly` | **Andrew** | Infrastructure cost impact |
| `publish_competitive_analysis` | **Kristina** | Strategy sensitivity |
| `production_deploy` | **Andrew** | Production stability |

---

## Red Actions (Both Founders Required)

| Action | Rationale |
|--------|-----------|
| `new_product_proposal` | New product line — strategic |
| `pricing_change` | Revenue model change |
| `architecture_shift` | Major technical direction |
| `enterprise_deal_large` | Large financial commitment |
| `brand_positioning_change` | Brand identity |
| `budget_reallocation` | Financial strategy |
| `agent_roster_change` | Agent team structure |
| `high_cost_commitment` | Significant spend |

---

## Decision Queue Workflow

Implemented in `packages/scheduler/src/decisionQueue.ts`.

```
1. Agent tool calls create_decision(tier, title, summary, reasoning, data)

2. authorityGates.checkAuthority(role, action)
     → GREEN:  Execute immediately, log in activity_log
     → YELLOW: Go to step 3
     → RED:    Go to step 3

3. DecisionQueue.submit(decision)
     → Write to `decisions` table (status: 'pending')
     → Build Adaptive Card via formatDecisionCard()
     → Send to #decisions via Graph API (preferred) or webhook (fallback)
     → Record notifiedAt timestamp

4. Decision sits in 'pending' status
     → sendReminders() runs on 4-hour interval
     → If (now - lastContact) > 4h → resend card with "⏰ REMINDER:" prefix
     → Yellow decisions auto-escalate to Red after 48 hours with no response

5. Founder responds (via Dashboard Approvals page)
     → processResponse(decisionId, founder, approved, comment)

6. For YELLOW decisions:
     → Single founder approval → finalize immediately

7. For RED decisions:
     → Track per-founder approvals in decision.approvals map
     → Both kristina AND andrew must respond
     → Only finalize when all founders have responded
     → All must approve for action to proceed

8. finalize(decision, approved)
     → Write to decision.resolved.{id}
     → Clear decision.pending.{id}
     → Log in activity.decision.{id}
     → Status: 'approved' or 'rejected'
```

### Decision Card Fields

When a decision is queued, the Adaptive Card includes:

| Field | Source |
|-------|--------|
| Tier badge | `decision.tier` (Green/Yellow/Red with colour) |
| Title | `decision.title` |
| Proposed by | `decision.proposedBy` (agent role) |
| Summary | `decision.summary` |
| Reasoning | `decision.reasoning` |
| Assigned to | `decision.assignedTo` (founder names) |
| Actions | Approve / Reject buttons (rendered in Teams or Dashboard) |

---

## `checkAuthority()` Function

```typescript
function checkAuthority(agentRole, action): AuthorityCheck {
  // 1. Check GREEN_ACTIONS[agentRole].has(action)
  //    → { allowed: true, tier: 'green', requiresApproval: false }

  // 2. Check YELLOW_ACTIONS[action]
  //    → { allowed: false, tier: 'yellow', requiresApproval: true,
  //        assignTo: ['andrew'] or ['kristina'] }

  // 3. Check RED_ACTIONS.has(action)
  //    → { allowed: false, tier: 'red', requiresApproval: true,
  //        assignTo: ['kristina', 'andrew'] }

  // 4. Unknown action → default to yellow, assign both founders
  //    → { allowed: false, tier: 'yellow', requiresApproval: true,
  //        assignTo: ['kristina', 'andrew'] }
}
```

### AuthorityCheck Return Type

```typescript
interface AuthorityCheck {
  allowed: boolean;           // Can the agent proceed?
  tier: 'green' | 'yellow' | 'red';
  requiresApproval: boolean;
  assignTo?: string[];        // Founder names for approval
  reason?: string;            // Human-readable explanation
}
```
